/**
 * `octopod setup`: what a machine needs, once — Docker checked, the API as a systemd user
 * service (what the console reads), the edge started. Safe to run again: after an
 * upgrade, it points the service at the octopod that runs it.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dockerEnv } from './docker.js';
import { declaredShellVersions, extensionsDir, GNOME_UUID, gnomePresent, installGnomeExtension } from './gnome.js';
import type { Octopod } from './octopod.js';

const run = promisify(execFile);

export interface SetupOptions {
  service: boolean;
  edge: boolean;
  /** The GNOME Shell extension: installed, when GNOME is there. */
  gnomeExtension?: boolean;
  /** `octopod mcp` registered with Claude Code for every folder of this user. */
  mcp?: boolean;
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
  // Retried without limit, every 5 s: octopod may live on a disk mounted after the session
  // starts (an encrypted home folder), and systemd gives up after 5 quick failures otherwise.
  return `[Unit]
Description=octopod — the API and the console's data
StartLimitIntervalSec=0

[Service]
ExecStart=${command.map(quote).join(' ')}
Environment=${quote(`PATH=${path}`)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** The command of `octopod mcp`: the service's, `mcp` instead of `serve`. */
export function mcpCommand(command = serviceCommand()): string[] {
  return [...command.slice(0, -1), 'mcp'];
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

  if (options.mcp) {
    log('Registering octopod as an MCP server for coding agents');
    // This very octopod, whatever the agent's PATH; the agent's folder names the project.
    const add = ['mcp', 'add', '--scope', 'user', 'octopod', '--', ...mcpCommand()];
    if (!(await works('claude', ['--version']))) {
      log(`  ! Claude Code (claude) is not on the PATH: register it with \`claude ${add.join(' ')}\`, or the same command in your client`);
    } else {
      // Registered again: the command may have moved (another clone, another node).
      await run('claude', ['mcp', 'remove', '--scope', 'user', 'octopod']).catch(() => undefined);
      await run('claude', add);
      log('  registered for Claude Code, every folder (claude mcp get octopod)');
    }
  }

  if (options.edge) {
    log('Starting the edge');
    const edge = await octopod.edgeUp();
    log(`  console ${edge.console}, Traefik dashboard ${edge.dashboard}`);
  }
}

/**
 * `octopod uninstall`: what `setup` and the projects put in place, taken away — the user
 * service first (it would bring the API back), the projects down with their data left in
 * them, the edge and the console, the GNOME extension. The state directory (registrations,
 * generated secrets) stays, unless `purge`: a database kept in a project opens only with
 * its secret. Says each thing it removed.
 */
export async function uninstall(octopod: Octopod, options: { purge: boolean; log: (line: string) => void }): Promise<void> {
  const { log } = options;
  const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'octopod.service');
  if (process.platform === 'linux' && (await stat(unit).then(() => true, () => false))) {
    await run('systemctl', ['--user', 'disable', '--now', 'octopod.service']).catch(() => undefined);
    await rm(unit, { force: true });
    await run('systemctl', ['--user', 'daemon-reload']).catch(() => undefined);
    log(`Removed the user service (${unit})`);
  }
  const stopped = await octopod.stopAll();
  log(stopped.length > 0 ? `Stopped ${stopped.join(', ')}: their data stays in their folders` : 'No project to stop');
  await octopod.edgeDown();
  log('Removed the edge and the console (their containers and network)');
  const extension = join(extensionsDir(), GNOME_UUID);
  if (await stat(extension).then(() => true, () => false)) {
    await run('gnome-extensions', ['disable', GNOME_UUID]).catch(() => undefined);
    await rm(extension, { recursive: true, force: true });
    log(`Removed the GNOME extension (${extension})`);
  }
  if (options.purge) {
    await rm(octopod.stateDir, { recursive: true, force: true });
    log(`Removed the state directory (${octopod.stateDir}): registrations and generated secrets are gone`);
  } else {
    log(`Kept the state directory (${octopod.stateDir}): registrations and the secrets your projects' data needs; --purge removes it`);
  }
  if (process.platform === 'win32') log('The tray icon and the octopod command stay: setup.ps1 put them in place, remove them from where it says');
  log('The octopod package itself stays: npm uninstall -g @quazardous/octopod, or delete the clone');
}
