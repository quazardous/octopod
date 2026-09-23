import { describe, it, expect } from 'vitest';
import { choosePort, composePorts, consoleNginxConfig, dataVolumes, duplicationBlockers, edgeCompose, imagePorts, LOCAL_ONLY, localOnlyConfig, projectOverride, traefikConfig } from './generate.js';
import { withInstance } from './declaration.js';
import { instanceName } from './names.js';
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
  it('only considers containers carrying its own exact label: not another edge\'s', () => {
    const docker = (traefikConfig('octopod').providers as { docker: Record<string, unknown> }).docker;
    expect(docker.exposedByDefault).toBe(false);
    expect(docker.constraints).toBe('Label(`octopod.edge`, `octopod`)');
    expect((traefikConfig('octopodtest').providers as { docker: Record<string, unknown> }).docker.constraints).toBe('Label(`octopod.edge`, `octopodtest`)');
  });

  const settings = { instance: 'octopod', port: 80, configFile: '/s/traefik.yml', dynamicDir: '/s/dynamic', consoleConfig: '/s/console.conf', socketDir: '/run/user/1000/octopod', owner: '1000:1000' };
  type Service = Record<string, string[] & Record<string, string>>;
  const services = (): Record<string, Service> => edgeCompose(settings).services as Record<string, Service>;

  it('listens on loopback only, and reads the docker socket read-only', () => {
    const { traefik } = services();
    expect(traefik.ports).toEqual(['127.0.0.1:80:80']);
    expect(traefik.volumes).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
  });

  it('reads octopod\'s own middlewares from a folder it watches', () => {
    expect((traefikConfig('octopod').providers as Record<string, unknown>).file).toEqual({ directory: '/etc/traefik/dynamic', watch: true });
    expect(services().traefik.volumes).toContain('/s/dynamic:/etc/traefik/dynamic:ro');
  });

  it('serves the console at octopod.localhost and the dashboard at traefik.localhost, to the host only', () => {
    const { traefik, console: relay } = services();
    expect(traefik.labels['traefik.http.routers.octopod-dashboard.rule']).toBe('Host(`traefik.localhost`)');
    expect(traefik.labels['traefik.http.routers.octopod-dashboard.middlewares']).toBe(LOCAL_ONLY);
    expect(relay.labels['traefik.http.routers.octopod-console.rule']).toBe('Host(`octopod.localhost`)');
    expect(relay.labels['traefik.http.routers.octopod-console.middlewares']).toBe(LOCAL_ONLY);
    expect(relay.labels['octopod.edge']).toBe('octopod');
  });

  it('lets through only loopback and the edge network, where the host\'s requests come from', () => {
    expect(localOnlyConfig(['10.195.64.0/20'])).toEqual({ http: { middlewares: { 'octopod-local': { ipAllowList: { sourceRange: ['127.0.0.1/32', '10.195.64.0/20'] } } } } });
  });

  it('runs the console relay as the operator, read-only, with no capability, on the socket\'s folder', () => {
    const relay = services().console as unknown as Record<string, unknown>;
    expect(relay.user).toBe('1000:1000');
    expect(relay.read_only).toBe(true);
    expect(relay.cap_drop).toEqual(['ALL']);
    expect(relay.ports).toBeUndefined();
    expect(relay.volumes).toEqual(['/s/console.conf:/etc/nginx/nginx.conf:ro', '/run/user/1000/octopod:/run/octopod:ro']);
  });

  it('runs it as nginx\'s own user where the operator has no uid (Windows): never as root', () => {
    const relay = (edgeCompose({ ...settings, owner: undefined }).services as Record<string, Service>).console as unknown as Record<string, unknown>;
    expect(relay.user).toBe('101:101');
  });

  it('reaches the API on the host loopback when it is on TCP, with its token, and mounts no socket', () => {
    const conf = consoleNginxConfig({ port: 18123, token: 'f00d' });
    expect(conf).toContain('proxy_pass http://host.docker.internal:18123;');
    expect(conf).toContain('proxy_set_header X-Octopod-Token "f00d";');
    expect(conf).toContain('limit_except GET { deny all; }');
    expect(conf).not.toContain('unix:');
    expect(conf).toContain('start the octopod tray');
    const relay = (edgeCompose({ ...settings, socketDir: undefined }).services as Record<string, Service>).console as unknown as Record<string, unknown>;
    expect(relay.volumes).toEqual(['/s/console.conf:/etc/nginx/nginx.conf:ro']);
    expect(relay.extra_hosts).toEqual(['host.docker.internal:host-gateway']);
    expect((services().console as unknown as Record<string, unknown>).extra_hosts).toBeUndefined();
  });

  it('relays GET to the socket and refuses every other method', () => {
    const conf = consoleNginxConfig('octopod.sock');
    expect(conf).toContain('proxy_pass http://unix:/run/octopod/octopod.sock;');
    expect(conf).toContain('limit_except GET { deny all; }');
    // The generated secrets are for local clients on the socket, never for the console.
    expect(conf).toMatch(/location ~ \^\/v1\/projects\/\[\^\/\]\+\/secrets \{\s*return 403;/);
  });

  it('recreates the edge when its configuration changes', () => {
    const labels = (edgeCompose({ ...settings, digest: 'abc' }).services as Record<string, Service>).traefik.labels;
    expect(labels['octopod.config']).toBe('abc');
  });
});

describe('a project override', () => {
  const override = projectOverride('octopod', DEMO, { web: {}, api: { networks: { backend: null } } }) as {
    services: Record<string, { labels: Record<string, string>; networks: Record<string, unknown> }>;
    networks: Record<string, { name: string; internal?: boolean }>;
  };

  it('routes each exposure to its host and port, on the project’s own edge network', () => {
    const web = override.services.web.labels;
    expect(web['octopod.edge']).toBe('octopod');
    expect(web['traefik.docker.network']).toBe('octopod-demo-edge');
    expect(web['traefik.http.routers.demo-demo.rule']).toBe('Host(`demo.localhost`)');
    expect(web['traefik.http.services.demo-demo.loadbalancer.server.port']).toBe('3000');
    expect(web['traefik.http.routers.demo-debug-demo.rule']).toBe('Host(`debug.demo.localhost`)');
    expect(web['traefik.http.services.demo-debug-demo.loadbalancer.server.port']).toBe('9229');
    expect(override.networks.octopod_edge).toEqual({ name: 'octopod-demo-edge', internal: true });
  });

  it('exposes one service under several hosts: a router and a Traefik service per host, none overwriting another', () => {
    const multi = { ...DEMO, expose: [{ service: 'web', host: 'demo.localhost', port: 80 }, { service: 'web', host: 'api.demo.localhost', port: 80 }, { service: 'web', host: 'apiv2.demo.localhost', port: 80 }] };
    const labels = (projectOverride('octopod', multi, { web: {} }) as { services: { web: { labels: Record<string, string> } } }).services.web.labels;
    expect(labels['traefik.http.routers.demo-demo.rule']).toBe('Host(`demo.localhost`)');
    expect(labels['traefik.http.routers.demo-api-demo.rule']).toBe('Host(`api.demo.localhost`)');
    expect(labels['traefik.http.routers.demo-apiv2-demo.rule']).toBe('Host(`apiv2.demo.localhost`)');
    expect(labels['traefik.http.routers.demo-api-demo.service']).toBe('demo-api-demo');
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

describe('ports', () => {
  it('reads a compose service\'s TCP ports from expose and from the container side of ports', () => {
    expect(composePorts({ expose: ['3000', '9229/tcp', '53/udp'], ports: [{ target: 8080, protocol: 'tcp' }, { target: 5353, protocol: 'udp' }, '127.0.0.1:18080:80', '4000'] }))
      .toEqual([3000, 9229, 8080, 80, 4000]);
    expect(composePorts({})).toEqual([]);
  });

  it('reads an image\'s EXPOSE, TCP only', () => {
    expect(imagePorts({ '80/tcp': {}, '443/tcp': {}, '53/udp': {} })).toEqual([80, 443]);
    expect(imagePorts(null)).toEqual([]);
  });

  it('takes the declared port first, then the compose file\'s, then the image\'s', () => {
    expect(choosePort(9000, [3000], [80])).toEqual({ port: 9000, source: 'declared', candidates: [] });
    expect(choosePort(undefined, [3000], [80])).toEqual({ port: 3000, source: 'compose', candidates: [] });
    expect(choosePort(undefined, [], [80])).toEqual({ port: 80, source: 'image', candidates: [] });
  });

  it('never refuses: among several, the likeliest web port; with none, a guess', () => {
    expect(choosePort(undefined, [], [443, 80])).toEqual({ port: 80, source: 'image', candidates: [443, 80] });
    expect(choosePort(undefined, [9229, 3000], [])).toEqual({ port: 3000, source: 'compose', candidates: [9229, 3000] });
    expect(choosePort(undefined, [7001, 7000], []).port).toBe(7000);
    expect(choosePort(undefined, [], [])).toEqual({ port: 80, source: 'guess', candidates: [] });
  });

  it('puts the resolved port in the labels', () => {
    const noPort = { ...DEMO, expose: [{ service: 'web', host: 'demo.localhost' }] };
    const labels = ((projectOverride('octopod', noPort, { web: {} }, {}, { 'demo.localhost': 3000 }) as { services: Record<string, { labels: Record<string, string> }> }).services.web.labels);
    expect(labels['traefik.http.services.demo-demo.loadbalancer.server.port']).toBe('3000');
  });
});

describe('environment', () => {
  it('never puts a variable into a service: labels, networks and volumes only', () => {
    const override = projectOverride('octopod', DEMO, { web: {}, api: {} }, { db: '/p/demo/.octopod/data/db' }, {}) as { services: Record<string, Record<string, unknown>> };
    for (const service of Object.values(override.services)) expect(Object.keys(service).sort()).toEqual(['labels', 'networks']);
  });
});

describe('instances', () => {
  it('names instance N after the project, and refuses what is not a DNS label', () => {
    expect(instanceName('demo', 1)).toBe('demo');
    expect(instanceName('demo', 2)).toBe('demo-2');
    expect(() => instanceName('demo', 0)).toThrow(/1 to 99/);
    expect(() => instanceName('a'.repeat(62), 2)).toThrow(/DNS label/);
  });

  it('moves every host of instance N under its own name', () => {
    const copy = withInstance(DEMO, 2);
    expect(copy.project).toBe('demo-2');
    expect(copy.expose.map((e) => e.host)).toEqual(['demo-2.localhost', 'debug.demo-2.localhost', 'api.demo-2.localhost']);
    expect(withInstance(DEMO, 1)).toBe(DEMO);
  });

  it('keeps instance N\'s data beside the first\'s', () => {
    expect(dataVolumes('/p/demo', { db: {} }, 2)).toEqual({ db: '/p/demo/.octopod/data/2/db' });
  });

  it('says what stops a project from running twice', () => {
    expect(duplicationBlockers({ web: {}, db: { ports: [{ target: 5432 }] } })).toEqual([]);
    expect(duplicationBlockers({ web: { container_name: 'shop' }, db: { ports: [{ target: 5432, published: '5432' } as { target: number }] } }))
      .toEqual(['web: container_name "shop" is fixed', 'db: publishes a fixed host port (5432)']);
  });
});
