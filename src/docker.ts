/**
 * The Docker CLI, as octopod uses it: arguments as an array (never a shell string),
 * output captured, a failure turned into an error that says what docker said.
 */
import { execFile } from 'node:child_process';

export class DockerError extends Error {}

export interface Docker {
  run(args: string[], options?: { input?: string; timeoutMs?: number }): Promise<string>;
}

export function cliDocker(binary = 'docker'): Docker {
  return {
    run(args, options = {}) {
      return new Promise((resolve, reject) => {
        const child = execFile(
          binary,
          args,
          { maxBuffer: 32 * 1024 * 1024, timeout: options.timeoutMs ?? 5 * 60_000 },
          (error, stdout, stderr) => {
            if (error) reject(new DockerError(`docker ${args.slice(0, 3).join(' ')}: ${(stderr || error.message).trim()}`));
            else resolve(stdout);
          },
        );
        if (options.input !== undefined) child.stdin?.end(options.input);
      });
    },
  };
}
