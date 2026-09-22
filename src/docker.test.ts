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
});
