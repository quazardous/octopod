import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Octopod, SHELL } from './octopod.js';
import type { Docker } from './docker.js';

let base: string;
let octopod: Octopod;
/** What `compose ps` answers: the state of each service. */
let states: Record<string, string>;

const docker: Docker = {
  run: async (args) =>
    args.includes('ps')
      ? Object.entries(states)
          .map(([Service, State]) => JSON.stringify({ Service, State }))
          .join('\n')
      : '',
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'octopod-shell-'));
  const root = join(base, 'demo');
  await mkdir(root);
  await writeFile(join(root, 'docker-compose.yml'), 'services: {}\n');
  await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - {service: web, port: 3000}\n');
  octopod = new Octopod({ stateDir: join(base, 'state'), docker, ports: [18498] });
  await octopod.register(root);
  states = { web: 'running', db: 'running' };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** What comes after compose's own arguments (`… -f override.json`). */
function tail(argv: string[]): string[] {
  return argv.slice(argv.findIndex((a) => a.endsWith('override.json')) + 1);
}

describe('octopod shell', () => {
  it('enters the first routed service, as its own user, with bash or sh', async () => {
    const argv = await octopod.shellCommand('demo', { tty: true });
    expect(argv.slice(0, 3)).toEqual(['docker', 'compose', '-p']);
    expect(tail(argv)).toEqual(['exec', 'web', ...SHELL]);
  });

  it('enters the service it is given, as root when asked, and runs a command instead of a shell', async () => {
    expect(tail(await octopod.shellCommand('demo', { service: 'db', root: true, tty: true }))).toEqual(['exec', '-u', '0', 'db', ...SHELL]);
    expect(tail(await octopod.shellCommand('demo', { command: ['npm', 'install'], tty: true }))).toEqual(['exec', 'web', 'npm', 'install']);
  });

  it('attaches no terminal when there is none', async () => {
    expect(tail(await octopod.shellCommand('demo', { command: ['id'], tty: false }))).toEqual(['exec', '-T', 'web', 'id']);
  });

  it('refuses a service that is not running, and says how to get in anyway', async () => {
    states = { web: 'restarting' };
    await expect(octopod.shellCommand('demo')).rejects.toThrow(/web is restarting: nothing to enter.*--oneshot/);
    states = {};
    await expect(octopod.shellCommand('demo')).rejects.toThrow(/web is not created.*octopod up/);
  });

  it('opens a fresh container of the service with --oneshot, kept out of the edge\'s routes', async () => {
    states = { web: 'restarting' };
    expect(tail(await octopod.shellCommand('demo', { oneshot: true, tty: true }))).toEqual([
      'run', '--rm', '--no-deps', '--label', 'traefik.enable=false', '--entrypoint', 'sh', 'web', ...SHELL.slice(1),
    ]);
  });

  it('names the services it has when asked for one it does not', async () => {
    await expect(octopod.shellCommand('demo', { service: 'nope' })).rejects.toThrow(/no service "nope" \(it has web, db\)/);
  });
});
