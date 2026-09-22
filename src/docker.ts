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
      return new Promise((resolve, reject) => {
        const child = execFile(
          binary,
          args,
          { maxBuffer: 32 * 1024 * 1024, timeout: options.timeoutMs ?? 5 * 60_000, env: dockerEnv() },
          (error, stdout, stderr) => {
            if (error) {
              const detail = options.withStderr ? `${stdout}${stderr}` : stderr || error.message;
              reject(new DockerError(`docker ${args.slice(0, 3).join(' ')}: ${detail.trim() || error.message}`));
            } else {
              resolve(options.withStderr ? `${stdout}${stderr}` : stdout);
            }
          },
        );
        if (options.input !== undefined) child.stdin?.end(options.input);
      });
    },
  };
}
