/**
 * The GNOME Shell extension, outside the shell: its pure modules (what it shows, what it
 * runs), held to what the Windows tray says; its install; what it must never hold.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledWith, GNOME_SOURCE, GNOME_UUID, installGnomeExtension, type Runner } from './gnome.js';

type Look = { up: boolean; dockerDown: boolean; line: string; title: string };
const load = async <T>(file: string): Promise<T> => (await import(pathToFileURL(join(GNOME_SOURCE, file)).href)) as T;
const { trayLook, projectLabel, projectState, actionNotice } = await load<{
  trayLook: (edge: unknown, why: string, projects: unknown[], version: unknown, hint?: string) => Look;
  projectLabel: (p: unknown) => string;
  projectState: (s: unknown) => string;
  actionNotice: (what: string, code: number, stderr: string) => { ok: boolean; text: string };
}>('look.js');
const { COMMANDS, START_SERVICE, octopodArgv, describe: describeCommand } = await load<{
  COMMANDS: Record<string, (p?: string) => string[]>;
  START_SERVICE: string[];
  octopodArgv: (base: string[], args: string[]) => string[];
  describe: (args: string[]) => string;
}>('actions.js');

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('the GNOME extension, outside the shell', () => {
  it('keeps its logic free of the shell: look.js and actions.js import nothing', async () => {
    for (const f of ['look.js', 'actions.js']) expect(await readFile(join(GNOME_SOURCE, f), 'utf8'), f).not.toMatch(/^\s*import\s/m);
  });

  it('says what the tray says, case by case', () => {
    const DESKTOP = 'is Docker Desktop running?';
    const cases: [unknown, string, unknown[], unknown, Partial<Look>][] = [
      [{ running: true, port: 80 }, '', [{ name: 'a' }], { version: '0.3.1' }, { up: true, line: 'The edge runs - 1 project', title: 'octopod 0.3.1' }],
      [{ running: true, port: 8480 }, '', [], null, { up: true, line: 'The edge runs on port 8480 - 0 projects', title: 'octopod' }],
      [{ running: false }, '', [{ name: 'a' }, { name: 'b' }], null, { up: false, line: 'The edge is stopped - 2 projects' }],
      [null, 'docker: failed to connect to the docker API', [], null, { up: false, dockerDown: true, line: `Docker does not answer: ${DESKTOP}` }],
      [null, 'its service does not answer\nmore', [], null, { up: false, dockerDown: false, line: 'octopod does not answer: its service does not answer' }],
    ];
    for (const [edge, why, projects, version, want] of cases) expect(trayLook(edge, why, projects, version, DESKTOP)).toMatchObject(want);
    expect(trayLook(null, 'Cannot connect to the Docker daemon', [], null).line).toBe('Docker does not answer: is the Docker service running?');
  });

  it.skipIf(!hasPwsh)('and the Windows tray says the same', { timeout: 60_000 }, () => {
    const ps = (script: string): { up: boolean; dockerDown: boolean; line: string } => {
      const r = spawnSync('pwsh', ['-NoProfile', '-Command', `. '${join(GNOME_SOURCE, '..', '..', 'bin', 'octopod-tray-look.ps1')}'; ${script} | ConvertTo-Json -Compress`], { encoding: 'utf8' });
      return JSON.parse(r.stdout);
    };
    const pairs: [string, Look][] = [
      [`Get-TrayLook @{ running = $true; port = 80 } '' @(@{ name = 'a' }) $null`, trayLook({ running: true, port: 80 }, '', [{ name: 'a' }], null)],
      [`Get-TrayLook @{ running = $true; port = 8480 } '' @() $null`, trayLook({ running: true, port: 8480 }, '', [], null)],
      [`Get-TrayLook @{ running = $false } '' @(@{ name = 'a' }, @{ name = 'b' }) $null`, trayLook({ running: false }, '', [{ name: 'a' }, { name: 'b' }], null)],
      [`Get-TrayLook $null 'docker: failed to connect' @() $null`, trayLook(null, 'docker: failed to connect', [], null, 'is Docker Desktop running?')],
    ];
    for (const [script, js] of pairs) {
      const tray = ps(script);
      expect({ up: js.up, dockerDown: js.dockerDown, line: js.line }).toEqual({ up: tray.up, dockerDown: tray.dockerDown, line: tray.line });
    }
    const balloon = ps(`Get-ActionBalloon 'octopod up demo' 1 "\`noctopod: project demo is not registered"`) as unknown as { text: string };
    expect(actionNotice('octopod up demo', 1, '\noctopod: project demo is not registered').text).toBe(balloon.text);
  });

  it('marks a project with a problem, and words its state', () => {
    expect(projectLabel({ name: 'demo', problem: 'broken octopod.yaml' })).toBe('demo (!)');
    expect(projectLabel({ name: 'demo' })).toBe('demo');
    expect(projectState({ services: [{ state: 'running' }, { state: 'exited' }, { state: 'tool' }], warnings: ['w'] })).toBe('1/2 running, 1 warning');
    expect(projectState({ services: [] })).toBe('down');
    expect(actionNotice('octopod edge up', 0, '')).toEqual({ ok: true, text: 'octopod edge up: done.' });
    expect(actionNotice('octopod edge up', 3, '')).toEqual({ ok: false, text: 'octopod edge up failed: exit code 3' });
  });

  it('runs argv, octopod itself first', () => {
    const base = ['/usr/bin/node', '/opt/octopod/bin/octopod.js'];
    expect(octopodArgv(base, COMMANDS.up('demo'))).toEqual([...base, 'up', 'demo']);
    expect(COMMANDS.down('demo')).toEqual(['down', 'demo']);
    expect(COMMANDS.edgeUp()).toEqual(['edge', 'up']);
    expect(COMMANDS.edgeDown()).toEqual(['edge', 'down']);
    expect(START_SERVICE).toEqual(['systemctl', '--user', 'start', 'octopod']);
    expect(describeCommand(['up', 'demo'])).toBe('octopod up demo');
  });

  it('holds no credential: the socket is the trust boundary', async () => {
    for (const f of await readdir(GNOME_SOURCE)) {
      const code = (await readFile(join(GNOME_SOURCE, f), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/token|authorization|bearer/i);
    }
  });

  it('declares its uuid as its folder, and the shell versions it runs on', async () => {
    const meta = JSON.parse(await readFile(join(GNOME_SOURCE, 'metadata.json'), 'utf8'));
    expect(meta.uuid).toBe(GNOME_UUID);
    expect(GNOME_SOURCE.endsWith(GNOME_UUID)).toBe(true);
    expect(meta['shell-version'].length).toBeGreaterThan(0);
  });
});

describe('installing the GNOME extension', () => {
  let target: string;
  let calls: string[][];
  let enabled: string;
  const run: Runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'gsettings' && args[0] === 'get') return `${enabled}\n`;
    if (command === 'gsettings' && args[0] === 'set') enabled = args[3];
    return '';
  };

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'octopod-gnome-'));
    calls = [];
    enabled = "['other@example.org']";
  });
  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('copies it with the tako and how to start octopod, and enables it the first time', async () => {
    const out = await installGnomeExtension({ argv: ['/usr/bin/node', '/opt/octopod/bin/octopod.js'], path: '/usr/bin', target, run });
    expect(out).toEqual({ dir: join(target, GNOME_UUID), enabled: true });
    const files = await readdir(out.dir);
    expect(files).toEqual(expect.arrayContaining(['metadata.json', 'extension.js', 'look.js', 'actions.js', 'octopodClient.js', 'stylesheet.css', 'icons', 'config.json']));
    expect(await readdir(join(out.dir, 'icons'))).toEqual(expect.arrayContaining(['octopod.svg', 'octopod-down.svg']));
    expect(JSON.parse(await readFile(join(out.dir, 'config.json'), 'utf8'))).toEqual({ argv: ['/usr/bin/node', '/opt/octopod/bin/octopod.js'], path: '/usr/bin' });
    expect(calls).toContainEqual(['gnome-extensions', 'enable', GNOME_UUID]);
    expect(enabled).toBe(`['other@example.org', '${GNOME_UUID}']`);
  });

  it('refreshes it without leftovers, and leaves it enabled or not as the user did', async () => {
    const first = await installGnomeExtension({ argv: ['octopod'], path: '/usr/bin', target, run });
    await writeFile(join(first.dir, 'stale.js'), 'old');
    calls = [];
    const again = await installGnomeExtension({ argv: ['octopod'], path: '/usr/bin', target, run });
    expect(again.enabled).toBe(false);
    expect(await readdir(again.dir)).not.toContain('stale.js');
    expect(calls).toEqual([]);
  });

  it('adds itself to enabled-extensions once, from an empty list too', () => {
    expect(enabledWith('@as []', GNOME_UUID)).toBe(`['${GNOME_UUID}']`);
    expect(enabledWith(`['a@b', '${GNOME_UUID}']`, GNOME_UUID)).toBeNull();
  });
});
