import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { listen } from './api.js';
import { Octopod } from './octopod.js';
import type { Docker } from './docker.js';

let base: string;
let socket: string;
let server: Server;

/** Docker that has nothing running: enough for everything but up/down. */
const idleDocker: Docker = { run: async () => '' };

function raw(method: string, path: string, body?: unknown): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, method, path, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const { status, text } = await raw(method, path, body);
  return { status, json: JSON.parse(text) };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'octopod-api-'));
  socket = join(base, 'run', 'octopod.sock');
  server = await listen(new Octopod({ stateDir: join(base, 'state'), docker: idleDocker, ports: [18499] }), socket);
  await mkdir(join(base, 'demo'));
  await writeFile(join(base, 'demo', 'docker-compose.yml'), 'services: {}\n');
  await writeFile(join(base, 'demo', 'octopod.yaml'), 'expose:\n  - {service: web, port: 3000, host: api}\n');
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(base, { recursive: true, force: true });
});

// A unix socket: the API does not run on Windows yet.
describe.skipIf(process.platform === 'win32')('the API', () => {
  it('is a socket only its owner can use', async () => {
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    expect((await stat(join(base, 'run'))).mode & 0o777).toBe(0o700);
  });

  it('registers a project from its declaration and lists it with its routes', async () => {
    const created = await call('POST', '/v1/projects', { root: join(base, 'demo') });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ name: 'demo', root: join(base, 'demo'), compose: [join(base, 'demo', 'docker-compose.yml')], routes: [{ service: 'web', url: 'http://api.demo.localhost:18499' }] });
    expect((await call('GET', '/v1/projects')).json).toEqual([created.json]);
  });

  it('registers the project of a folder when it is not yet, once, and refuses its name from another folder', async () => {
    const octopod = new Octopod({ stateDir: join(base, 'state'), docker: idleDocker, ports: [18499] });
    expect(await octopod.ensureRegistered(join(base, 'demo'))).toEqual({ name: 'demo', registered: true });
    expect(await octopod.ensureRegistered(join(base, 'demo'))).toEqual({ name: 'demo', registered: false });
    await mkdir(join(base, 'elsewhere'));
    await writeFile(join(base, 'elsewhere', 'docker-compose.yml'), 'services: {}\n');
    await writeFile(join(base, 'elsewhere', 'octopod.yaml'), 'project: demo\nexpose:\n  - {service: web, port: 1}\n');
    await expect(octopod.ensureRegistered(join(base, 'elsewhere'))).rejects.toThrow(/already registered from/);
  });

  it('gives the secrets octopod generated, of every running instance or of one, and only the values', async () => {
    await call('POST', '/v1/projects', { root: join(base, 'demo') });
    const state = join(base, 'state', 'projects');
    await mkdir(join(state, 'demo'), { recursive: true });
    await mkdir(join(state, 'demo-2'), { recursive: true });
    await writeFile(join(state, 'demo', 'secrets.json'), JSON.stringify({ db: { password: 'p1', 'root-password': 'r1' } }));
    await writeFile(join(state, 'demo-2', 'secrets.json'), JSON.stringify({ db: { password: 'p2' } }));
    await writeFile(join(state, 'demo', 'instances.json'), '[2]');
    expect((await call('GET', '/v1/projects/demo/secrets')).json).toEqual({ values: ['p1', 'r1', 'p2'] });
    expect((await call('GET', '/v1/projects/demo/secrets?instance=2')).json).toEqual({ values: ['p2'] });
    expect((await call('GET', '/v1/projects/nope/secrets')).status).toBe(409);
  });

  it('lists every project, one that cannot be read with its problem, never hiding the others', async () => {
    await call('POST', '/v1/projects', { root: join(base, 'demo') });
    await mkdir(join(base, 'broken'));
    await writeFile(join(base, 'broken', 'docker-compose.yml'), 'services: {}\n');
    await writeFile(join(base, 'broken', 'octopod.yaml'), 'expose:\n  - {service: web, port: 1}\n');
    await call('POST', '/v1/projects', { root: join(base, 'broken') });
    await writeFile(join(base, 'broken', 'octopod.yaml'), 'services:\n  app: { recipe: no-such-recipe }\n');
    const list = (await call('GET', '/v1/projects')).json as { name: string; problem?: string }[];
    expect(list.map((p) => p.name).sort()).toEqual(['broken', 'demo']);
    expect(list.find((p) => p.name === 'demo')?.problem).toBeUndefined();
    expect(list.find((p) => p.name === 'broken')?.problem).toMatch(/no recipe 'no-such-recipe'/);
  });

  it('lists the projects of a group, or carrying a tag', async () => {
    await writeFile(join(base, 'demo', 'octopod.yaml'), 'group: m2m\ntags: [php]\nexpose:\n  - {service: web, port: 3000, host: api}\n');
    await call('POST', '/v1/projects', { root: join(base, 'demo') });
    await mkdir(join(base, 'other'));
    await writeFile(join(base, 'other', 'docker-compose.yml'), 'services: {}\n');
    await writeFile(join(base, 'other', 'octopod.yaml'), 'tags: [node]\nexpose:\n  - {service: web, port: 1}\n');
    await call('POST', '/v1/projects', { root: join(base, 'other') });
    const names = async (q: string) => ((await call('GET', `/v1/projects${q}`)).json as { name: string }[]).map((p) => p.name).sort();
    expect(await names('')).toEqual(['demo', 'other']);
    expect(await names('?group=m2m')).toEqual(['demo']);
    expect(await names('?tag=node')).toEqual(['other']);
    expect(await names('?tag=nope')).toEqual([]);
    const demo = ((await call('GET', '/v1/projects')).json as { name: string; group?: string; tags?: string[] }[]).find((p) => p.name === 'demo');
    expect(demo).toEqual(expect.objectContaining({ group: 'm2m', tags: ['php'] }));
  });

  it('answers 400 for a relative root, a broken body or a broken declaration', async () => {
    expect((await call('POST', '/v1/projects', { root: 'demo' })).status).toBe(400);
    expect((await call('POST', '/v1/projects', '{not json')).status).toBe(400);
    await writeFile(join(base, 'demo', 'octopod.yaml'), 'expose: []\n');
    expect((await call('POST', '/v1/projects', { root: join(base, 'demo') })).status).toBe(400);
  });

  it('answers 409 for a project it does not know, and 404 for a route it does not have', async () => {
    expect((await call('GET', '/v1/projects/nope')).status).toBe(409);
    expect((await call('GET', '/v2/anything')).status).toBe(404);
  });

  it('says its version and the contract it speaks, from package.json', async () => {
    const { version } = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect((await call('GET', '/v1/version')).json).toEqual({ version, contract: 1, features: ['secrets'] });
  });

  it('reports the edge as stopped when nothing runs', async () => {
    expect((await call('GET', '/v1/edge')).json).toEqual({ running: false, port: null, dashboard: null, console: null });
  });

  it('serves the console: its page and the two files it loads, under a policy that allows nothing else', async () => {
    const page = await raw('GET', '/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.text).toContain('<script src="/console.js" defer></script>');
    expect((await raw('GET', '/console.js')).headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect((await raw('GET', '/console.css')).status).toBe(200);
    // The tray's icon as the tab's.
    expect(page.text).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" id="icon">');
    expect(page.text).toContain('href="https://github.com/quazardous/octopod"');
    expect(page.text).toContain('<img id="mascot" class="logo" src="/favicon.svg"');
    expect(page.text).toContain('<details id="help" class="help">');
    expect((await raw('GET', '/traefik.png')).headers['content-type']).toBe('image/png');
    const svg = await raw('GET', '/favicon.svg');
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect(svg.text).toContain('<svg');
    expect((await raw('GET', '/favicon.ico')).headers['content-type']).toBe('image/x-icon');
    // Kept by the browser: the grey one is shown when nothing can be fetched.
    expect(svg.headers['cache-control']).toBe('max-age=86400');
    expect((await raw('GET', '/favicon-down.svg')).text).toContain('<svg');
    expect((await raw('GET', '/console.js')).headers['cache-control']).toBe('no-store');
    expect((await raw('GET', '/package.json')).status).toBe(404);
    expect((await raw('GET', '/../src/api.ts')).status).toBe(404);
  });
});

// Windows has no unix sockets: the API is on loopback, behind a token. Tested everywhere.
describe('the API on TCP', () => {
  let state: string;
  let tcpServer: Server;
  let octopod: Octopod;

  beforeEach(async () => {
    state = await mkdtemp(join(tmpdir(), 'octopod-tcp-'));
    octopod = new Octopod({ stateDir: state, docker: idleDocker, ports: [18499], tcp: true });
    tcpServer = await listen(octopod);
  });

  afterEach(async () => {
    await new Promise((r) => tcpServer.close(r));
    await rm(state, { recursive: true, force: true });
  });

  function get(path: string, token?: string): Promise<{ status: number; text: string }> {
    return octopod.apiTcp().then(
      ({ port }) =>
        new Promise((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port, path, headers: token === undefined ? {} : { 'x-octopod-token': token } }, (res) => {
            let text = '';
            res.on('data', (c) => (text += String(c)));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
          });
          req.on('error', reject);
          req.end();
        }),
    );
  }

  it('answers only a request that carries the token of api.json', async () => {
    const { token } = await octopod.apiTcp();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await get('/v1/version')).status).toBe(401);
    expect((await get('/', 'x'.repeat(64))).status).toBe(401);
    expect((await get('/v1/version', `${token}0`)).status).toBe(401);
    const answer = await get('/v1/version', token);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toMatchObject({ contract: 1 });
  });

  it('serves the tako of the tray as the icon of the console', async () => {
    const { token } = await octopod.apiTcp();
    const svg = await get('/favicon.svg', token);
    expect(svg.status).toBe(200);
    expect(svg.text).toContain('<svg');
    expect((await get('/favicon.ico', token)).status).toBe(200);
    expect((await get('/favicon-down.svg', token)).text).toContain('#9aa3ad');
  });

  it('keeps its port and token, and listens on loopback only', async () => {
    const first = await octopod.apiTcp();
    expect(await new Octopod({ stateDir: state, tcp: true }).apiTcp()).toEqual(first);
    expect(JSON.parse(await readFile(join(state, 'api.json'), 'utf8'))).toEqual(first);
    expect(tcpServer.address()).toMatchObject({ address: '127.0.0.1', port: first.port });
  });
});
