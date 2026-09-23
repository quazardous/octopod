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
    // `cat` reads its input to the end: it returns only because the input is closed.
    await expect(cliDocker('cat').run([], { timeoutMs: 5000 })).resolves.toBe('');
  });
});
