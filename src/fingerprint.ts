/**
 * What `octopod serve` runs and reads as its own — its code, its built-in recipes, its
 * version — as one string. The service keeps the code it started with but reads recipes
 * from disk: after a pull or an upgrade, old code would read new recipes. So it compares,
 * and restarts onto the new code when a supervisor (systemd, the Windows tray) will bring
 * it back.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The newest mtime of the files under `dir` whose name matches; 0 when there is no such folder. */
async function newest(dir: string, match: RegExp): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let latest = 0;
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) latest = Math.max(latest, await newest(path, match));
    else if (match.test(e.name)) latest = Math.max(latest, (await stat(path).catch(() => ({ mtimeMs: 0 }))).mtimeMs);
  }
  return latest;
}

/**
 * The version, and the newest mtime of the code (dist/ from a package, src/ from a clone,
 * its tests aside) and of the built-in recipes. Not console/ — served from disk, right after
 * a reload — nor a project's own recipes, whose changes are normal.
 */
export async function fingerprint(root = PACKAGE_ROOT): Promise<string> {
  const version = await readFile(join(root, 'package.json'), 'utf8').then((t) => (JSON.parse(t) as { version?: string }).version ?? '', () => '');
  const code = Math.max(await newest(join(root, 'dist'), /\.js$/), await newest(join(root, 'src'), /^(?!.*\.test\.ts$).*\.ts$/));
  const recipes = await newest(join(root, 'recipes'), /./);
  return `${version}|${code}|${recipes}`;
}

export interface SelfWatchOptions {
  /** The fingerprint the service started with. */
  initial: string;
  fingerprint?: () => Promise<string>;
  now?: () => number;
  /** How long it must hold still before the restart: a pull writes many files. */
  quietMs?: number;
  /** A supervisor brings it back (systemd, the tray): then it may exit. */
  supervised: boolean;
  log: (line: string) => void;
  restart: () => void;
}

export interface SelfWatch {
  /** Read the fingerprint again; restart once it has changed and held still. */
  tick(): Promise<void>;
  /** octopod changed on disk since the service started. */
  changed(): boolean;
}

export function selfWatch(options: SelfWatchOptions): SelfWatch {
  const read = options.fingerprint ?? (() => fingerprint());
  const now = options.now ?? Date.now;
  const quiet = options.quietMs ?? 3000;
  let seen = options.initial;
  let since = 0;
  let changed = false;
  let done = false;
  return {
    changed: () => changed,
    async tick() {
      if (done) return;
      const current = await read();
      if (current === options.initial && !changed) return;
      changed = true;
      if (current !== seen) {
        seen = current;
        since = now();
        return;
      }
      if (now() - since < quiet) return;
      done = true;
      if (options.supervised) {
        options.log('octopod changed on disk: restarting onto the new code');
        options.restart();
      } else {
        options.log('octopod changed on disk: restart `octopod serve` to run the new code');
      }
    },
  };
}

/** Under systemd (it sets INVOCATION_ID) or the Windows tray (OCTOPOD_SUPERVISED): something restarts it. */
export function supervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.INVOCATION_ID || env.OCTOPOD_SUPERVISED);
}

/** The exit code of a restart onto new code: non-zero, so `Restart=on-failure` brings it back. */
export const RESTART_EXIT = 75;
