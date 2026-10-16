import { describe, it, expect } from 'vitest';
import { dockerEnv } from './docker.js';

describe('dockerEnv', () => {
  it('passes docker what it needs to reach the daemon, and none of the shell\'s other variables', () => {
    const env = dockerEnv({
      PATH: '/usr/bin',
      HOME: '/home/op',
      XDG_RUNTIME_DIR: '/run/user/1000',
      DOCKER_HOST: 'unix:///run/docker.sock',
      LC_ALL: 'C.UTF-8',
      COMPOSE_FILE: 'other.yml',
      COMPOSE_PROFILES: 'everything',
      DATABASE_PASSWORD: 'hunter2',
      BUSHWHACK_OCTOPOD: '/x',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/op', XDG_RUNTIME_DIR: '/run/user/1000', DOCKER_HOST: 'unix:///run/docker.sock', LC_ALL: 'C.UTF-8' });
  });

  it('on Windows, whatever their case, and what docker needs there to find compose and its contexts', () => {
    const vars = { Path: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\op', SystemRoot: 'C:\\Windows', COMPOSE_FILE: 'other.yml' };
    expect(dockerEnv(vars, 'win32')).toEqual({ Path: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\op', SystemRoot: 'C:\\Windows' });
    expect(dockerEnv(vars, 'linux')).toEqual({});
  });
});

describe('the docker runner', () => {
  it('closes the input it gives a command, so a question never waits for an answer', async () => {
    const { cliDocker } = await import('./docker.js');
    // It reads its input to the end: it returns only because the input is closed. Node, not
    // `cat`, which a Windows runner may not have.
    await expect(cliDocker(process.execPath).run(['-e', 'process.stdin.resume()'], { timeoutMs: 5000 })).resolves.toBe('');
  });
});

describe('compose up after Docker lost a network', () => {
  it('makes the containers again, once, when one refers to a network that is gone — and only then', async () => {
    const { composeUp, DockerError } = await import('./docker.js');
    const calls: string[][] = [];
    let fail: string | undefined = 'Error response from daemon: failed to set up container networking: network 61b9df29a1b2c3d4 not found';
    const docker = {
      run: async (args: string[]) => {
        calls.push(args);
        if (fail) {
          const message = fail;
          fail = undefined;
          throw new DockerError(message);
        }
        return '';
      },
    };
    await composeUp(docker, ['compose', 'up', '-d']);
    expect(calls).toEqual([['compose', 'up', '-d'], ['compose', 'up', '-d', '--force-recreate']]);

    calls.length = 0;
    fail = 'pull access denied for nope';
    await expect(composeUp(docker, ['compose', 'up', '-d'])).rejects.toThrow(/pull access denied/);
    expect(calls).toEqual([['compose', 'up', '-d']]);
  });
});
