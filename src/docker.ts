/**
 * The Docker CLI, as octopod uses it: arguments as an array (never a shell string),
 * output captured, a failure turned into an error that says what docker said.
 */
import { execFile } from 'node:child_process';

export class DockerError extends Error {}

export interface RunOptions {
  input?: string;
  timeoutMs?: number;
  /** Return stderr after stdout: a command's diagnostics are usually on stderr. */
  withStderr?: boolean;
}

export interface Docker {
  run(args: string[], options?: RunOptions): Promise<string>;
}

/**
 * What docker gets of octopod's own environment: what it needs to find and reach the
 * daemon, and nothing else. Every other variable of the calling shell — a COMPOSE_FILE, a
 * COMPOSE_PROFILES, anything a compose file interpolates — would otherwise flow into the
 * project, unseen. A project's variables come from its own `.env` or declared env file.
 */
const PASSED = /^(PATH|HOME|USER|LOGNAME|LANG|LC_[A-Z_]+|TZ|TMPDIR|XDG_RUNTIME_DIR|XDG_CONFIG_HOME|SSH_AUTH_SOCK|DOCKER_[A-Z_]+|BUILDX_[A-Z_]+)$/;

export function dockerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => PASSED.test(k)));
}

export function cliDocker(binary = 'docker'): Docker {
  return {
    run(args, options = {}) {
      const debug = Boolean(process.env.OCTOPOD_DEBUG);
      const started = Date.now();
      if (debug) console.error(`octopod: docker ${args.join(' ')} …`);
      return new Promise((resolve, reject) => {
        const child = execFile(
          binary,
          args,
          // SIGKILL past the timeout: docker compose may not exit on SIGTERM, and the command
          // would then never end.
          { maxBuffer: 32 * 1024 * 1024, timeout: options.timeoutMs ?? 5 * 60_000, killSignal: 'SIGKILL', env: dockerEnv() },
          (error, stdout, stderr) => {
            if (debug) console.error(`octopod: docker ${args.join(' ')} — ${((Date.now() - started) / 1000).toFixed(1)} s${error ? ' (failed)' : ''}`);
            if (error) {
              // What it printed, then how it ended: a command that prints nothing (a timeout,
              // a quiet failure) must still say why it failed.
              const detail = (options.withStderr ? `${stdout}${stderr}` : stderr).trim();
              const failed = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
              const how = failed.killed
                ? `timed out after ${Math.round((options.timeoutMs ?? 5 * 60_000) / 1000)} s`
                : typeof failed.code === 'number'
                  ? `exit code ${failed.code}`
                  : error.message;
              reject(new DockerError(`docker ${args.slice(0, 3).join(' ')}: ${detail ? `${detail}\n` : ''}(${how})`));
            } else {
              resolve(options.withStderr ? `${stdout}${stderr}` : stdout);
            }
          },
        );
        // Always closed: with nothing to read, a question docker or compose asks (recreate a
        // volume, a network?) gets an end of input at once, instead of waiting for ever for an
        // answer nobody can type.
        child.stdin?.end(options.input);
      });
    },
  };
}
