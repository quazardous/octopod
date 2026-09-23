/**
 * `octopod setup`: what a machine needs, once — Docker checked, the API as a systemd user
 * service (what the console reads), the edge started. Safe to run again: after an
 * upgrade, it points the service at the octopod that runs it.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dockerEnv } from './docker.js';
import { declaredShellVersions, gnomePresent, installGnomeExtension } from './gnome.js';
import type { Octopod } from './octopod.js';

const run = promisify(execFile);

export interface SetupOptions {
  service: boolean;
  edge: boolean;
  /** The GNOME Shell extension: installed, when GNOME is there. */
  gnomeExtension?: boolean;
  log: (line: string) => void;
}

async function works(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  return run(command, args, { timeout: 30_000, env }).then(
    () => true,
    () => false,
  );
}

/** What a user service needs to start this very octopod: node, its flags (tsx from a clone), the entry point. */
export function serviceCommand(execPath = process.execPath, execArgv = process.execArgv, entry = process.argv[1]): string[] {
  return [execPath, ...execArgv, entry, 'serve'];
}

/** The unit file: systemd splits ExecStart on spaces, so every word is quoted. */
export function serviceUnit(command: string[], path: string): string {
  const quote = (w: string): string => `"${w.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `[Unit]
Description=octopod — the API and the console's data

[Service]
ExecStart=${command.map(quote).join(' ')}
Environment=${quote(`PATH=${path}`)}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export async function setup(octopod: Octopod, options: SetupOptions): Promise<void> {
  const { log } = options;
  log('Checking Docker');
  if (!(await works('docker', ['version'], dockerEnv()))) throw new Error('Docker is not installed, or its daemon does not answer: is it running, and may your user use it?');
  if (!(await works('docker', ['compose', 'version'], dockerEnv()))) throw new Error('Docker Compose v2 (docker compose) is missing');
  log('  docker and compose answer');

  if (options.service) {
    log('Serving the API (for the console and other tools)');
    if (process.platform === 'linux' && (await works('systemctl', ['--user', 'show-environment']))) {
      const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
      await mkdir(dir, { recursive: true });
      // The PATH of this shell: the service runs docker, and must find it as you do.
      await writeFile(join(dir, 'octopod.service'), serviceUnit(serviceCommand(), process.env.PATH ?? '/usr/bin:/bin'));
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', 'octopod.service']);
      await run('systemctl', ['--user', 'restart', 'octopod.service']);
      log('  octopod.service enabled and started (systemctl --user status octopod)');
    } else {
      log('  ! no systemd user session: run `octopod serve` yourself for the console');
    }
  }

  if (options.gnomeExtension) {
    log('Installing the GNOME Shell extension');
    if (!(await gnomePresent())) {
      log('  ! no GNOME session here (XDG_CURRENT_DESKTOP, gnome-extensions): skipped');
    } else {
      // The command octopod's service runs, less `serve`: this very octopod, whatever the shell's PATH.
      const installed = await installGnomeExtension({ argv: serviceCommand().slice(0, -1), path: process.env.PATH ?? '/usr/bin:/bin' });
      log(`  ${installed.dir} (GNOME Shell ${(await declaredShellVersions()).join(', ')})`);
      log(
        installed.enabled
          ? '  enabled: it shows after you log out and in again (Wayland loads extensions at login)'
          : '  refreshed, enabled or not as you left it: log out and in again to load the new code',
      );
    }
  }

  if (options.edge) {
    log('Starting the edge');
    const edge = await octopod.edgeUp();
    log(`  console ${edge.console}, Traefik dashboard ${edge.dashboard}`);
  }
}
