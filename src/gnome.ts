/**
 * The GNOME Shell extension (gnome/<uuid>/): installed by `octopod setup --gnome-extension`,
 * the Windows tray's counterpart on Linux. A plain copy into the user's extensions folder,
 * the tako's icons beside it, and a config.json that says how to start this very octopod —
 * the shell's PATH often lacks ~/.local/bin, and docker's folder.
 */
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const GNOME_UUID = 'octopod@quazardous.github.io';
export const GNOME_SOURCE = fileURLToPath(new URL(`../gnome/${GNOME_UUID}`, import.meta.url));
const ASSETS = fileURLToPath(new URL('../assets', import.meta.url));

/** Runs a command for its output; undefined when it fails or is missing. */
export type Runner = (command: string, args: string[]) => Promise<string | undefined>;

const execRunner: Runner = (command, args) =>
  promisify(execFile)(command, args, { timeout: 15_000 }).then(
    (r) => r.stdout,
    () => undefined,
  );

/** Where GNOME Shell reads a user's extensions. */
export function extensionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'gnome-shell', 'extensions');
}

/** A GNOME session, whose shell can load an extension. */
export async function gnomePresent(env: NodeJS.ProcessEnv = process.env, run: Runner = execRunner): Promise<boolean> {
  return /gnome/i.test(env.XDG_CURRENT_DESKTOP ?? '') && (await run('gnome-extensions', ['version'])) !== undefined;
}

/**
 * The value of org.gnome.shell enabled-extensions with `uuid` added, or null when it is
 * there already. The key is a GVariant string array: `@as []` when empty, `['a', 'b']`.
 */
export function enabledWith(current: string, uuid: string): string | null {
  const names = [...current.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  if (names.includes(uuid)) return null;
  return `[${[...names, uuid].map((n) => `'${n}'`).join(', ')}]`;
}

export interface GnomeInstall {
  dir: string;
  /** Installed now for the first time, and enabled; a refresh keeps the user's choice. */
  enabled: boolean;
}

/**
 * Copy the extension (the former copy removed first: a stale file would load beside the new
 * ones), its icons and config.json; enable it the first time. `argv` starts octopod.
 */
export async function installGnomeExtension(options: { argv: string[]; path: string; target?: string; run?: Runner }): Promise<GnomeInstall> {
  const run = options.run ?? execRunner;
  const dir = join(options.target ?? extensionsDir(), GNOME_UUID);
  const fresh = !(await stat(dir).then(() => true, () => false));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(GNOME_SOURCE, dir, { recursive: true });
  await mkdir(join(dir, 'icons'), { recursive: true });
  for (const icon of ['octopod.svg', 'octopod-down.svg']) await cp(join(ASSETS, icon), join(dir, 'icons', icon));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ argv: options.argv, path: options.path }, null, 2) + '\n');
  if (!fresh) return { dir, enabled: false };
  // Both: a running Wayland shell does not see a new extension ("does not exist"), but the
  // key is read at the next login.
  await run('gnome-extensions', ['enable', GNOME_UUID]);
  const current = await run('gsettings', ['get', 'org.gnome.shell', 'enabled-extensions']);
  const next = current === undefined ? null : enabledWith(current.trim(), GNOME_UUID);
  if (next) await run('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', next]);
  return { dir, enabled: true };
}

/** The extension's declared shell versions, for a message. */
export async function declaredShellVersions(): Promise<string[]> {
  return (JSON.parse(await readFile(join(GNOME_SOURCE, 'metadata.json'), 'utf8')) as { 'shell-version': string[] })['shell-version'];
}
