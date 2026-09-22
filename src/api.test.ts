import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
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

function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, method, path, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
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

describe('the API', () => {
  it('is a socket only its owner can use', async () => {
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    expect((await stat(join(base, 'run'))).mode & 0o777).toBe(0o700);
  });

  it('registers a project from its declaration and lists it with its routes', async () => {
    const created = await call('POST', '/v1/projects', { root: join(base, 'demo') });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ name: 'demo', root: join(base, 'demo'), routes: [{ service: 'web', url: 'http://api.demo.localhost:18499' }] });
    expect((await call('GET', '/v1/projects')).json).toEqual([created.json]);
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

  it('reports the edge as stopped when nothing runs', async () => {
    expect((await call('GET', '/v1/edge')).json).toEqual({ running: false, port: null, dashboard: null });
  });
});
