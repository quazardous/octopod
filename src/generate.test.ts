import { describe, it, expect } from 'vitest';
import { dataVolumes, edgeCompose, projectOverride, traefikConfig } from './generate.js';
import { fullHost, slugify } from './names.js';
import type { Declaration } from './declaration.js';

const DEMO: Declaration = {
  project: 'demo',
  root: '/p/demo',
  compose: ['/p/demo/docker-compose.yml'],
  expose: [
    { service: 'web', port: 3000, host: 'demo.localhost' },
    { service: 'web', port: 9229, host: 'debug.demo.localhost' },
    { service: 'api', port: 8080, host: 'api.demo.localhost' },
  ],
};

describe('names', () => {
  it('keeps every host inside its project', () => {
    expect(fullHost('demo', undefined)).toBe('demo.localhost');
    expect(fullHost('demo', 'api.v2')).toBe('api.v2.demo.localhost');
    expect(() => fullHost('demo', '../other')).toThrow(/not a DNS label/);
    expect(() => fullHost('demo', 'a b')).toThrow(/not a DNS label/);
  });

  it('turns a folder name into a DNS label', () => {
    expect(slugify('My Project_2')).toBe('my-project-2');
    expect(slugify('---')).toBe('project');
  });
});

describe('the edge', () => {
  it('only considers containers carrying the exact octopod label', () => {
    const docker = (traefikConfig().providers as { docker: Record<string, unknown> }).docker;
    expect(docker.exposedByDefault).toBe(false);
    expect(docker.constraints).toBe('Label(`octopod.edge`, `1`)');
  });

  it('listens on loopback only, and reads the docker socket read-only', () => {
    const traefik = (edgeCompose({ instance: 'octopod', port: 80, configFile: '/s/traefik.yml' }).services as Record<string, Record<string, string[]>>).traefik;
    expect(traefik.ports).toEqual(['127.0.0.1:80:80']);
    expect(traefik.volumes).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
  });
});

describe('a project override', () => {
  const override = projectOverride('octopod', DEMO, { web: {}, api: { networks: { backend: null } } }) as {
    services: Record<string, { labels: Record<string, string>; networks: Record<string, unknown> }>;
    networks: Record<string, { name: string; internal?: boolean }>;
  };

  it('routes each exposure to its host and port, on the project’s own edge network', () => {
    const web = override.services.web.labels;
    expect(web['octopod.edge']).toBe('1');
    expect(web['traefik.docker.network']).toBe('octopod-demo-edge');
    expect(web['traefik.http.routers.demo-demo.rule']).toBe('Host(`demo.localhost`)');
    expect(web['traefik.http.services.demo-demo.loadbalancer.server.port']).toBe('3000');
    expect(web['traefik.http.routers.demo-debug-demo.rule']).toBe('Host(`debug.demo.localhost`)');
    expect(web['traefik.http.services.demo-debug-demo.loadbalancer.server.port']).toBe('9229');
    expect(override.networks.octopod_edge).toEqual({ name: 'octopod-demo-edge', internal: true });
  });

  it('keeps a service on the networks it had — the implicit default one included', () => {
    expect(Object.keys(override.services.web.networks)).toEqual(['default', 'octopod_edge']);
    expect(Object.keys(override.services.api.networks)).toEqual(['backend', 'octopod_edge']);
  });

  it('refuses an exposure of a service the project does not have', () => {
    expect(() => projectOverride('octopod', DEMO, { web: {} })).toThrow(/service "api" is not in/);
  });
});

describe('data', () => {
  it('binds the project\'s own named volumes to folders in the project', () => {
    const data = dataVolumes('/p/demo', {
      db: { name: 'demo_db' },
      cache: { name: 'demo_cache', driver: 'local' },
      shared: { name: 'shared', external: true },
      nfs: { name: 'demo_nfs', driver_opts: { type: 'nfs', o: 'addr=10.0.0.1' } },
      plugin: { name: 'demo_plugin', driver: 'rexray' },
    });
    expect(data).toEqual({ db: '/p/demo/.octopod/data/db', cache: '/p/demo/.octopod/data/cache' });
    const override = projectOverride('octopod', DEMO, { web: {}, api: {} }, data) as { volumes: Record<string, unknown> };
    expect(override.volumes.db).toEqual({ driver: 'local', driver_opts: { type: 'none', o: 'bind', device: '/p/demo/.octopod/data/db' } });
    expect(Object.keys(override.volumes)).toEqual(['db', 'cache']);
  });

  it('adds no volumes section to a project that has none', () => {
    expect(projectOverride('octopod', DEMO, { web: {}, api: {} })).not.toHaveProperty('volumes');
  });
});
