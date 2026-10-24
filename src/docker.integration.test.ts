/**
 * Against real Docker: two projects behind one edge. Uses its own instance prefix and
 * port, so it never touches a real octopod edge. Skipped when Docker is not available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Server } from 'node:http';
import { listen } from './api.js';
import { Octopod, prepareSocketDir } from './octopod.js';

const INSTANCE = 'octopodtest';
const PORT = 18480;
const NEIGHBOUR = 'octopodtest-neighbour';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

/** The console's session, once the tests enrolled: sent with every request to the console. */
let consoleCookie = '';

async function get(
  host: string,
  path = '/',
  method = 'GET',
  headers: Record<string, string> = {},
  timeoutMs = 3000,
  payload?: string,
): Promise<{ status: number; body: string; cookie?: string }> {
  // Node's fetch refuses to set Host; a plain request to the edge with the header does it.
  const { request } = await import('node:http');
  const all: Record<string, string> = { Host: host, ...(host === 'octopod.localhost' && consoleCookie ? { Cookie: consoleCookie } : {}), ...headers };
  if (payload !== undefined) all['Content-Type'] = 'application/json';
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method, headers: all, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }));
    });
    // The option only says the time is up: the request must be ended here, or a route to a
    // service that just went down can keep it open for ever.
    req.on('timeout', () => req.destroy(new Error(`no answer from ${host} within ${timeoutMs / 1000} s`)));
    req.on('error', reject);
    req.end(payload);
  });
}

/** Traefik picks routes up asynchronously: ask until the answer is what we expect, or give up. */
async function eventually(host: string, status: number, path = '/', method = 'GET'): Promise<{ status: number; body: string }> {
  let last = { status: 0, body: '' };
  for (let i = 0; i < 40; i++) {
    last = await get(host, path, method).catch(() => ({ status: 0, body: '' }));
    if (last.status === status) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

/** A database's actions, round trip: load a table, dump it, reset, load the dump back. */
async function roundTrip(octopod: Octopod, project: string, service: string, dir: string): Promise<void> {
  const sql = join(dir, `${service}-seed.sql`);
  const dump = join(dir, `${service}-dump.sql`);
  const again = join(dir, `${service}-again.sql`);
  await writeFile(sql, 'CREATE TABLE marker (x int);\nINSERT INTO marker VALUES (4242);\n');
  await expect(octopod.runAction(project, service, 'load', { input: sql })).rejects.toThrow(/confirm it/);
  expect(await octopod.runAction(project, service, 'load', { input: sql, confirm: true })).toEqual(expect.objectContaining({ ok: true }));
  expect(await octopod.runAction(project, service, 'dump', { output: dump })).toEqual(expect.objectContaining({ ok: true }));
  expect(await readFile(dump, 'utf8')).toContain('4242');
  expect((await stat(dump)).mode & 0o777).toBe(0o600);
  expect(await octopod.runAction(project, service, 'reset', { confirm: true })).toEqual(expect.objectContaining({ ok: true }));
  await octopod.runAction(project, service, 'dump', { output: again });
  expect(await readFile(again, 'utf8')).not.toContain('4242');
  expect(await octopod.runAction(project, service, 'load', { input: dump, confirm: true })).toEqual(expect.objectContaining({ ok: true }));
  await octopod.runAction(project, service, 'dump', { output: again });
  expect(await readFile(again, 'utf8')).toContain('4242');
  await expect(octopod.runAction(project, service, 'shell')).rejects.toThrow(/interactive/);
}

async function project(base: string, name: string, port?: number): Promise<string> {
  const root = join(base, name);
  await mkdir(root);
  await writeFile(join(root, 'docker-compose.yml'), 'services:\n  web:\n    image: traefik/whoami:v1.10\n');
  await writeFile(join(root, 'octopod.yaml'), `project: ${name}\nexpose:\n  - service: web\n${port ? `    port: ${port}\n` : ''}`);
  return root;
}

describe.skipIf(!dockerAvailable())('two projects behind one edge (real docker)', { timeout: 300_000 }, () => {
  let base: string;
  let octopod: Octopod;
  let api: Server | undefined;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-it-'));
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT], socket: join(base, 'run', 'octopod.sock') });
    const alpha = await project(base, 'alpha', 80);
    // The project's own override, which compose loads by itself and octopod must too.
    // The project's own override: an environment, and a router of its own (a host outside
    // its name, pointing at the service octopod generated) — the escape hatch of the layering.
    await writeFile(
      join(alpha, 'docker-compose.override.yml'),
      'services:\n  web:\n    environment:\n      WHOAMI_NAME: from-override\n    labels:\n      traefik.http.routers.alpha-extra.rule: "Host(`extra.localhost`)"\n      traefik.http.routers.alpha-extra.entrypoints: web\n      traefik.http.routers.alpha-extra.service: alpha-alpha\n',
    );
    await octopod.register(alpha);
    // No port: whoami's image says EXPOSE 80, and octopod has to find it. Its name comes
    // from a declared env file — and a variable of octopod's own shell must not reach it.
    const beta = await project(base, 'beta');
    await writeFile(join(beta, 'docker-compose.yml'), 'services:\n  web:\n    image: traefik/whoami:v1.10\n    environment:\n      WHOAMI_NAME: "${BETA_NAME:-unset}-${OCTOPOD_LEAK:-clean}"\n');
    await writeFile(join(beta, 'compose.env'), 'BETA_NAME=from-env-file\n');
    await writeFile(join(beta, 'octopod.yaml'), 'project: beta\nenv_file: compose.env\nexpose:\n  - service: web\n');
    process.env.OCTOPOD_LEAK = 'leaked';
    await octopod.register(beta);
    await octopod.up('alpha');
    await octopod.up('beta');
    // A container labelled for some other Traefik, on a network the edge does reach — the
    // case the label constraint exists for. (On a network the edge cannot reach, Traefik
    // would drop it anyway, and the test would prove nothing.)
    docker('run', '-d', '--rm', '--name', NEIGHBOUR, '--network', 'octopodtest-alpha-edge', '--label', 'traefik.enable=true', '--label', 'traefik.http.routers.nb.rule=Host(`neighbour.localhost`)', 'traefik/whoami:v1.10');
  }, 300_000);

  afterAll(async () => {
    if (api) await new Promise((r) => api?.close(r));
    try {
      docker('rm', '-f', NEIGHBOUR);
    } catch {
      // already gone
    }
    await octopod.unregister('alpha').catch(() => undefined);
    await octopod.unregister('beta').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 300_000);

  it('serves each project on its own host', async () => {
    const alpha = await eventually('alpha.localhost', 200);
    const beta = await eventually('beta.localhost', 200);
    expect(alpha.status).toBe(200);
    expect(beta.status).toBe(200);
    // whoami answers with its container's hostname: two different containers.
    const host = (body: string): string | undefined => /Hostname: (\S+)/.exec(body)?.[1];
    expect(host(alpha.body)).toBeDefined();
    expect(host(alpha.body)).not.toBe(host(beta.body));
  });

  it('applies the project\'s own compose override', async () => {
    expect((await eventually('alpha.localhost', 200)).body).toContain('Name: from-override');
    expect((await eventually('beta.localhost', 200)).body).not.toContain('from-override');
  });

  it('reads a declared env file, and nothing of octopod\'s own environment', async () => {
    expect((await eventually('beta.localhost', 200)).body).toContain('Name: from-env-file-clean');
  });

  it('runs a second instance of a project beside the first, and stops it alone', async () => {
    const second = await octopod.up('alpha', 2);
    expect(second.routes.map((r) => r.url)).toEqual([`http://alpha-2.localhost:${PORT}`]);
    expect((await octopod.status('alpha')).instances).toEqual([2]);
    const host = (body: string): string | undefined => /Hostname: (\S+)/.exec(body)?.[1];
    const one = await eventually('alpha.localhost', 200);
    const two = await eventually('alpha-2.localhost', 200);
    expect(two.status).toBe(200);
    expect(host(two.body)).not.toBe(host(one.body));
    await octopod.down('alpha', { instance: 2 });
    expect((await eventually('alpha-2.localhost', 404)).status).toBe(404);
    expect((await eventually('alpha.localhost', 200)).status).toBe(200);
    expect((await octopod.status('alpha')).instances).toBeUndefined();
  });

  it('serves the console at octopod.localhost, says how to start the API when it is not running, and reads through it once it is', async () => {
    const down = await eventually('octopod.localhost', 503);
    expect(down.body).toContain('octopod serve');
    api = await listen(octopod, octopod.socket);
    const page = await eventually('octopod.localhost', 200);
    expect(page.body).toContain('<script src="/console.js" defer></script>');
    // Nothing but the page until the browser enrolls, with a code from the command line.
    expect((await get('octopod.localhost', '/v1/projects')).status).toBe(401);
    const enroll = (code: string, header: Record<string, string> = { 'X-Octopod-Console': '1' }) =>
      get('octopod.localhost', '/v1/console/enroll', 'POST', header, 3000, JSON.stringify({ code }));
    const { code } = await octopod.access.code();
    expect((await enroll(code, {})).status).toBe(403);
    const enrolled = await enroll(code);
    expect(enrolled.status).toBe(200);
    consoleCookie = enrolled.cookie ?? '';
    expect(consoleCookie).toMatch(/^octopod_console=/);
    // A header a request brings cannot pass for the relay's: the API still sees the console.
    expect((await get('octopod.localhost', '/v1/projects', 'GET', { Cookie: '', 'X-Octopod-Via': '' })).status).toBe(401);
    const projects = JSON.parse((await eventually('octopod.localhost', 200, '/v1/projects')).body) as { name: string }[];
    expect(projects.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
    expect(JSON.parse((await get('octopod.localhost', '/v1/edge')).body)).toEqual(expect.objectContaining({ running: true, console: `http://octopod.localhost:${PORT}` }));
  });

  it('refuses through the console anything but reading, and a project\'s up and down from its own page', async () => {
    // Up to the API's socket, this would take the project down: without the console's
    // header (what a page of another site sends) the relay stops it first.
    expect((await get('octopod.localhost', '/v1/projects/alpha/down', 'POST')).status).toBe(403);
    const console = { 'X-Octopod-Console': '1' };
    expect((await get('octopod.localhost', '/v1/projects/alpha/restart', 'POST', console)).status).toBe(403);
    expect((await get('octopod.localhost', '/v1/projects/alpha/exec', 'POST', console)).status).toBe(403);
    expect((await get('octopod.localhost', '/v1/edge/down', 'POST', console)).status).toBe(403);
    // Nor the secrets octopod generated: they are for local clients, on the socket.
    expect((await get('octopod.localhost', '/v1/projects/alpha/secrets')).status).toBe(403);
    expect((await get('octopod.localhost', '/v1/projects/alpha/%73ecrets')).status).toBe(403);
    expect((await octopod.status('alpha')).services).toEqual([expect.objectContaining({ state: 'running' })]);
  });

  it('brings a project down and up from the console', async () => {
    const console = { 'X-Octopod-Console': '1' };
    expect((await get('octopod.localhost', '/v1/projects/alpha/down', 'POST', console, 60_000)).status).toBe(200);
    expect((await octopod.status('alpha')).services).toEqual([]);
    expect((await get('octopod.localhost', '/v1/projects/alpha/up', 'POST', console, 120_000)).status).toBe(200);
    expect((await eventually('alpha.localhost', 200)).status).toBe(200);
  }, 200_000);

  it('keeps the console and the dashboard from the projects\' containers', async () => {
    await eventually('octopod.localhost', 200);
    // From a project's edge network, where its containers reach the edge (on its published
    // port, which it listens on inside too). A raw request
    // (busybox wget sends its own Host header before any given one), its input kept open
    // until the answer is in: a closed one reads to Traefik as a client gone (499).
    const from = (host: string): string =>
      execFileSync('docker', ['run', '--rm', '--network', 'octopodtest-alpha-edge', 'alpine:3.20', 'sh', '-c', `(printf 'GET / HTTP/1.0\\r\\nHost: ${host}\\r\\n\\r\\n'; sleep 3) | nc -w 5 ${INSTANCE}-edge ${PORT} | head -1`], { encoding: 'utf8' });
    expect(from('octopod.localhost')).toMatch(/403/);
    expect(from('traefik.localhost')).toMatch(/403/);
    expect(from('alpha.localhost')).toMatch(/200/);
    // From the host, both answer.
    expect((await eventually('traefik.localhost', 302)).status).toBe(302);
  });

  it("keeps a project's routes from another project's containers, whatever Host they send", async () => {
    await eventually('alpha.localhost', 200);
    await eventually('beta.localhost', 200);
    const from = (network: string, host: string): string =>
      execFileSync('docker', ['run', '--rm', '--network', network, 'alpine:3.20', 'sh', '-c', `(printf 'GET / HTTP/1.0\\r\\nHost: ${host}\\r\\n\\r\\n'; sleep 3) | nc -w 5 ${INSTANCE}-edge ${PORT} | head -1`], { encoding: 'utf8' });
    expect(from('octopodtest-alpha-edge', 'alpha.localhost')).toMatch(/200/);
    expect(from('octopodtest-alpha-edge', 'beta.localhost')).toMatch(/403/);
    expect(from('octopodtest-beta-edge', 'alpha.localhost')).toMatch(/403/);
    // The host reaches both.
    expect((await get('beta.localhost', '/')).status).toBe(200);
  });

  it('serves a router the project added in its own compose file, next to octopod\'s', async () => {
    expect((await eventually('extra.localhost', 200)).body).toContain('Name: from-override');
    expect((await eventually('alpha.localhost', 200)).status).toBe(200);
  });

  it('answers 404 for a host no project declared', async () => {
    expect((await eventually('nobody.localhost', 404)).status).toBe(404);
  });

  it('does not adopt a neighbour labelled for another Traefik', async () => {
    await eventually('alpha.localhost', 200);
    // Give Traefik time to have seen the neighbour, then check it did not route to it.
    await new Promise((r) => setTimeout(r, 2000));
    expect((await get('neighbour.localhost')).status).toBe(404);
  });

  it('keeps projects off each other’s networks, with the edge on both', () => {
    const networksOf = (container: string): string[] =>
      Object.keys(JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', container)) as object);
    expect(networksOf('alpha-web-1').sort()).toEqual(['alpha_default', 'octopodtest-alpha-edge']);
    expect(networksOf('beta-web-1').sort()).toEqual(['beta_default', 'octopodtest-beta-edge']);
    expect(networksOf('octopodtest-edge')).toEqual(expect.arrayContaining(['octopodtest-alpha-edge', 'octopodtest-beta-edge']));
  });

  it('reports what runs and where', async () => {
    const status = await octopod.status('alpha');
    expect(status.routes).toEqual([{ service: 'web', url: `http://alpha.localhost:${PORT}`, port: 80, portSource: 'declared' }]);
    expect((await octopod.status('beta')).routes).toEqual([{ service: 'web', url: `http://beta.localhost:${PORT}`, port: 80, portSource: 'image' }]);
    expect(status.compose.map((f) => basename(f))).toEqual(['docker-compose.yml', 'docker-compose.override.yml']);
    expect(status.services).toEqual([expect.objectContaining({ service: 'web', state: 'running' })]);
  });

  it('runs a command in a service, argv as given, and restarts a service', async () => {
    const ok = await octopod.exec('alpha', 'web', ['/whoami', '--help']);
    expect(ok.ok).toBe(true);
    expect(ok.output).toMatch(/Usage|port/i);
    expect(ok.mode).toBe('exec');
    const bad = await octopod.exec('alpha', 'web', ['/does-not-exist']);
    expect(bad.ok).toBe(false);
    // However it failed, it says how it ended.
    expect(bad.output).toMatch(/\(exit code \d+\)/);
    const restarted = await octopod.restart('alpha', 'web');
    expect(restarted.services).toEqual([expect.objectContaining({ service: 'web', state: 'running' })]);
    expect((await eventually('alpha.localhost', 200)).status).toBe(200);
  });

  it("lets a project's routed containers reach its own hosts, at the browser's URL", async () => {
    const root = join(base, 'hostsp');
    await mkdir(root);
    await writeFile(join(root, 'docker-compose.yml'), 'services:\n  web:\n    image: traefik/whoami:v1.10\n  client:\n    image: busybox:1.37\n    command: [sleep, infinity]\n');
    await writeFile(join(root, 'octopod.yaml'), 'project: hostsp\nexpose:\n  - service: web\n  - service: web\n    host: api\n  - service: client\n    host: client\n    port: 80\n');
    await octopod.register(root);
    try {
      await octopod.up('hostsp');
      expect((await eventually('api.hostsp.localhost', 200)).body).toContain('Host: api.hostsp.localhost');
      // The edge's port is not 80 here: the same URL from inside, through the edge.
      const inside = await octopod.exec('hostsp', 'client', ['wget', '-qO-', `http://api.hostsp.localhost:${PORT}/`]);
      expect(inside.ok).toBe(true);
      expect(inside.output).toContain('Host: api.hostsp.localhost');
    } finally {
      await octopod.unregister('hostsp').catch(() => undefined);
    }
  });

  it('runs a command in a service that restarts in a loop, in a one-off container the edge does not route to', async () => {
    // An app that dies at start — as one does before its dependencies are installed.
    const gamma = join(base, 'gamma');
    await mkdir(gamma);
    await writeFile(join(gamma, 'docker-compose.yml'), 'services:\n  web:\n    image: traefik/whoami:v1.10\n    command: ["--port", "not-a-port"]\n    restart: always\n');
    await writeFile(join(gamma, 'octopod.yaml'), 'project: gamma\nexpose:\n  - service: web\n    port: 80\n');
    await octopod.register(gamma);
    try {
      await octopod.up('gamma').catch(() => undefined);
      const result = await octopod.exec('gamma', 'web', ['/whoami', '--help']);
      expect(result).toEqual(expect.objectContaining({ ok: true, mode: 'run' }));
      expect(result.output).toMatch(/Usage|port/i);
      // Gone once done: nothing left beside the service's own container.
      const left = docker('ps', '-a', '--filter', 'label=com.docker.compose.project=octopodtest-gamma', '--format', '{{.Names}}').trim().split('\n').filter(Boolean);
      expect(left.every((n) => !n.includes('run'))).toBe(true);
    } finally {
      await octopod.unregister('gamma').catch(() => undefined);
    }
  });

  it('runs a command in a service through octopod shell, its exit code kept, and refuses a service that is down', async () => {
    const argv = await octopod.shellCommand('alpha', { command: ['/whoami', '--help'], tty: false });
    const ran = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
    expect(`${ran.stdout}${ran.stderr}`).toMatch(/Usage|port/i);
    const fails = await octopod.shellCommand('alpha', { command: ['/does-not-exist'], tty: false });
    expect(spawnSync(fails[0], fails.slice(1)).status).not.toBe(0);
    await expect(octopod.shellCommand('alpha', { instance: 3 })).rejects.toThrow(/not created/);
  });

  it('puts the edge network in internal mode: routing works, and it is no way out', () => {
    const internal = docker('network', 'inspect', '--format', '{{.Internal}}', 'octopodtest-alpha-edge').trim();
    expect(internal).toBe('true');
  });

  it('brings a project down cleanly, network included, while the other keeps running', async () => {
    await octopod.down('beta');
    expect(docker('network', 'ls', '--format', '{{.Name}}').split('\n')).not.toContain('octopodtest-beta-edge');
    expect((await eventually('alpha.localhost', 200)).status).toBe(200);
    expect((await eventually('beta.localhost', 404)).status).toBe(404);
  });
});

describe.skipIf(!dockerAvailable())('data in the project (real docker)', { timeout: 300_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;
  const me = `${process.getuid?.()}:${process.getgid?.()}`;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-data-'));
    root = join(base, 'gamma');
    await mkdir(root);
    await writeFile(
      join(root, 'docker-compose.yml'),
      [
        'services:',
        '  web:',
        '    image: traefik/whoami:v1.10',
        '  store:',
        '    image: alpine:3.20',
        `    user: "${me}"`,
        '    command: sh -c "echo kept > /data/row && sleep 600"',
        '    volumes: [db:/data]',
        '  rooted:',
        '    image: alpine:3.20',
        '    command: sh -c "echo mine > /logs/root-file && sleep 600"',
        '    volumes: [logs:/logs]',
        'volumes:',
        '  db: {}',
        '  logs: {}',
        '',
      ].join('\n'),
    );
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n    port: 80\n');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(root);
  }, 300_000);

  afterAll(async () => {
    await octopod.down('gamma', { volumes: true }).catch(() => undefined);
    await octopod.unregister('gamma').catch(() => undefined);
    await octopod.edgeDown();
    // What a root service wrote, only root can delete: the case the warning is about.
    docker('run', '--rm', '-v', `${base}:/base`, 'alpine:3.20', 'rm', '-rf', '/base/gamma/.octopod');
    await rm(base, { recursive: true, force: true });
    try {
      docker('volume', 'rm', 'gamma_stale');
    } catch {
      // not created
    }
  }, 300_000);

  it('keeps named volumes in the project, out of git, owned by the operator', async () => {
    await octopod.up('gamma');
    const row = join(root, '.octopod', 'data', 'db', 'row');
    for (let i = 0; i < 40 && !(await stat(row).catch(() => undefined)); i++) await new Promise((r) => setTimeout(r, 250));
    expect(await readFile(row, 'utf8')).toBe('kept\n');
    expect((await stat(row)).uid).toBe(process.getuid?.());
    expect(await readFile(join(root, '.octopod', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('says which data folder holds files the operator does not own', async () => {
    const file = join(root, '.octopod', 'data', 'logs', 'root-file');
    for (let i = 0; i < 40 && !(await stat(file).catch(() => undefined)); i++) await new Promise((r) => setTimeout(r, 250));
    const status = await octopod.status('gamma');
    expect(status.warnings).toContainEqual(expect.stringMatching(/^\.octopod\/data\/logs holds files owned by uid 0/));
  });

  it('says which service runs as root, from its running process', async () => {
    const status = await octopod.status('gamma');
    expect(status.warnings).toContainEqual(expect.stringMatching(/^rooted runs as root/));
    expect((status.warnings ?? []).filter((w) => w.startsWith('store '))).toEqual([]);
  });

  it('keeps the data through down --volumes: it is the project\'s', async () => {
    await octopod.down('gamma', { volumes: true });
    expect(await readFile(join(root, '.octopod', 'data', 'db', 'row'), 'utf8')).toBe('kept\n');
  });

  it('refuses to bind over a volume that already holds data in Docker', async () => {
    await writeFile(join(root, 'docker-compose.yml'), 'services:\n  web:\n    image: traefik/whoami:v1.10\n    volumes: [stale:/x]\nvolumes:\n  stale: {}\n');
    docker('volume', 'create', 'gamma_stale');
    await expect(octopod.up('gamma')).rejects.toThrow(/gamma_stale already holds data in Docker's storage/);
  });
});

describe.skipIf(!dockerAvailable())('a project made of recipes (real docker)', { timeout: 600_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-recipes-'));
    root = join(base, 'delta');
    await mkdir(root);
    // A Node project and nothing else: no compose file, no Dockerfile — only recipes.
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'delta', scripts: { dev: 'node server.js' } }));
    // It tries its database once, at start — as an app that connects on boot does, and fails
    // on a refused connection when it starts before its database is ready.
    await writeFile(
      join(root, 'server.js'),
      [
        "const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;",
        "let db = url ? 'trying' : 'none';",
        "if (url) require('node:net').connect(Number(url.port), url.hostname).on('connect', function () { db = 'ready-at-start'; this.end(); }).on('error', () => (db = 'refused-at-start'));",
        "require('node:http').createServer((q, r) => r.end(`user=${require('node:os').userInfo().username} db=${db}`)).listen(process.env.PORT, process.env.HOST);",
        '',
      ].join('\n'),
    );
    await writeFile(join(root, 'octopod.yaml'), 'services:\n  app: { recipe: node-app, home: true, workdir: /delta }\n  db: { recipe: postgres }\n');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
  }, 600_000);

  afterAll(async () => {
    await octopod.unregister('delta').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 600_000);

  it('plans it before anything runs, writing nothing', async () => {
    const plan = await octopod.plan(root);
    expect(plan.text).toMatch(/\+ app  node-app@[0-9a-f]{12}/);
    expect(plan.text).toContain('data    db-data (in .octopod/data)');
    await expect(stat(join(root, '.octopod'))).rejects.toThrow();
  });

  it('serves the app as a user named after the project, wired to its database', async () => {
    await octopod.register(root);
    const status = await octopod.up('delta');
    expect(status.routes).toEqual([expect.objectContaining({ service: 'app', url: `http://delta.localhost:${PORT}`, port: 3000, portSource: 'compose' })]);
    const answer = await eventually('delta.localhost', 200);
    // Started once its database was healthy: its first connection was answered.
    expect(answer.body).toBe('user=delta db=ready-at-start');
  });

  it('keeps the database in the project, owned by the operator', async () => {
    const data = join(root, '.octopod', 'data', 'db-data');
    for (let i = 0; i < 60 && !(await stat(join(data, 'PG_VERSION')).catch(() => undefined)); i++) await new Promise((r) => setTimeout(r, 500));
    expect((await stat(join(data, 'PG_VERSION'))).uid).toBe(process.getuid?.());
    const status = await octopod.status('delta');
    expect(status.warnings ?? []).toEqual([]);
    expect(status.services).toEqual(expect.arrayContaining([expect.objectContaining({ service: 'db', state: 'running' })]));
  });

  it('dumps its database, resets it and loads the dump back, through the recipe\'s actions', async () => {
    await roundTrip(octopod, 'delta', 'db', base);
  });

  it('keeps the app user\'s home in the project, mounts the project where it says, and says where you are', async () => {
    const result = await octopod.exec('delta', 'app', ['bash', '-ic', 'echo "home=$HOME pwd=$(pwd) prompt=$PS1"; echo kept >> ~/.probe']);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('home=/home/delta pwd=/delta');
    expect(result.output).toMatch(/prompt=.*delta:app/);
    const probe = join(root, '.octopod', 'home', 'app', '.probe');
    expect(await readFile(probe, 'utf8')).toBe('kept\n');
    expect((await stat(probe)).uid).toBe(process.getuid?.());
  });

  it('removes what it built when the project is unregistered, and keeps the data', async () => {
    await octopod.unregister('delta');
    expect(docker('images', '--format', '{{.Repository}}').split('\n')).not.toEqual(expect.arrayContaining(['delta-app']));
    expect(docker('volume', 'ls', '--format', '{{.Name}}').split('\n')).not.toContain('delta_db-data');
    expect((await stat(join(root, '.octopod', 'data', 'db-data', 'PG_VERSION'))).isFile()).toBe(true);
  });

  it('keeps the secrets the kept data was made with, and drops them with the data', async () => {
    await octopod.register(root);
    const before = await octopod.secrets('delta');
    expect(before.length).toBeGreaterThan(0);
    await octopod.unregister('delta');
    await octopod.register(root);
    expect(await octopod.secrets('delta')).toEqual(before);
    await rm(join(root, '.octopod', 'data'), { recursive: true, force: true });
    await octopod.unregister('delta');
    await expect(stat(join(base, 'state', 'projects', 'delta'))).rejects.toThrow();
  });
});

describe.skipIf(!dockerAvailable())('the examples (real docker)', { timeout: 600_000 }, () => {
  const EXAMPLES = new URL('../examples/', import.meta.url);
  let base: string;
  let octopod: Octopod;

  beforeAll(async () => {
    // Copies: running an example writes its .octopod/ into it, and the repository stays clean.
    base = await mkdtemp(join(tmpdir(), 'octopod-examples-'));
    await cp(EXAMPLES, base, { recursive: true });
    octopod = new Octopod({ stateDir: join(base, '.state'), instance: INSTANCE, ports: [PORT], socket: join(base, '.run', 'octopod.sock') });
  }, 600_000);

  afterAll(async () => {
    for (const name of await octopod.names()) await octopod.unregister(name).catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 600_000);

  it('covers every example: a new one needs its test here', async () => {
    const examples = (await readdir(EXAMPLES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(examples).toEqual(['node-postgres', 'whoami']);
  });

  it('whoami: its two services, each on its own host', async () => {
    const { name } = await octopod.ensureRegistered(join(base, 'whoami'));
    await octopod.up(name);
    expect((await eventually('whoami.localhost', 200)).body).toMatch(/Hostname:/);
    expect((await eventually('api.whoami.localhost', 200)).body).toContain('Name: api');
  });

  it('node-postgres: the app, as its own user, finds its database from the first request', async () => {
    const { name } = await octopod.ensureRegistered(join(base, 'node-postgres'));
    await octopod.up(name);
    const answer = await eventually('node-postgres.localhost', 200);
    expect(answer.body).toContain('Hello from node-postgres, the user named after the project.');
    expect(answer.body).toContain('Database: db:5432/app');
  });
});

describe.skipIf(!dockerAvailable())('a PHP project made of recipes (real docker)', { timeout: 900_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-php-'));
    root = join(base, 'phpapp');
    await mkdir(join(root, 'public'), { recursive: true });
    await mkdir(join(root, 'docker', 'supervisor'), { recursive: true });
    // The app says who runs it, on which PHP, whether its database answers, and writes a
    // file into the project — which must end up the operator's.
    await writeFile(
      join(root, 'public', 'index.php'),
      [
        '<?php',
        '$u = parse_url(getenv("DATABASE_URL"));',
        'try {',
        '  new PDO("mysql:host={$u["host"]};port={$u["port"]};dbname=" . ltrim($u["path"], "/"), $u["user"], $u["pass"]);',
        '  $db = "ok";',
        '} catch (Throwable $e) { $db = "error: " . $e->getMessage(); }',
        'file_put_contents(__DIR__ . "/../written.txt", "x");',
        'echo "user=" . posix_getpwuid(posix_geteuid())["name"] . " php=" . PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION . " db=$db";',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'octopod.yaml'),
      [
        'services:',
        '  app:',
        '    recipe: php-app',
        '    extensions: [pdo_mysql]',
        '    supervisor_d: docker/supervisor',
        '    programs:',
        '      worker: { command: "php -r \\"while (true) sleep(60);\\"" }',
        '      seed: { command: "php -r \\"file_put_contents(\'/app/seeded.txt\', \'s\');\\"", autostart: false }',
        '  db: { recipe: mariadb }',
        '  cli: { recipe: php-cli }',
        '',
      ].join('\n'),
    );
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT], socket: join(base, 'run', 'octopod.sock') });
  }, 900_000);

  afterAll(async () => {
    await octopod.unregister('phpapp').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 900_000);

  it('serves the app as a user named after the project, with its extensions and its database', async () => {
    const { name } = await octopod.ensureRegistered(root);
    await octopod.up(name);
    const answer = await eventually('phpapp.localhost', 200);
    expect(answer.body).toBe('user=phpapp php=8.4 db=ok');
    expect((await stat(join(root, 'written.txt'))).uid).toBe(process.getuid?.());
  });

  it('runs the project\'s programs beside php-fpm and nginx, a task only when started', async () => {
    const state = async () => Object.fromEntries((await octopod.programs('phpapp')).map((p) => [p.program, p.state]));
    let states = await state();
    for (let i = 0; i < 20 && states.worker !== 'RUNNING'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      states = await state();
    }
    expect(states).toEqual({ nginx: 'RUNNING', 'php-fpm': 'RUNNING', worker: 'RUNNING', seed: 'STOPPED' });
    const app = (await octopod.status('phpapp')).services.find((x) => x.service === 'app');
    expect(app?.programs?.map((p) => p.program).sort()).toEqual(['nginx', 'php-fpm', 'seed', 'worker']);
    const after = await octopod.program('phpapp', 'app', 'seed', 'start');
    expect(after.find((p) => p.program === 'seed')?.state).toMatch(/EXITED|STARTING|RUNNING/);
    for (let i = 0; i < 20 && !(await stat(join(root, 'seeded.txt')).catch(() => undefined)); i++) await new Promise((r) => setTimeout(r, 250));
    expect((await stat(join(root, 'seeded.txt'))).uid).toBe(process.getuid?.());
    await expect(octopod.program('phpapp', 'app', 'nope', 'start')).rejects.toThrow(/no program "nope"/);
    await expect(octopod.program('phpapp', 'db', 'x', 'start')).rejects.toThrow(/runs no supervisor/);
  });

  it('dumps its MariaDB, resets it and loads the dump back, through the recipe\'s actions', async () => {
    await roundTrip(octopod, 'phpapp', 'db', base);
  });

  it('keeps a tool out of up, and runs it on demand as the project\'s user, its cache kept', async () => {
    const status = await octopod.status('phpapp');
    expect(status.services.find((x) => x.service === 'cli')?.state).toBe('tool');
    const result = await octopod.exec('phpapp', 'cli', ['php', '-r', 'file_put_contents("/cache/probe", "x"); echo posix_getpwuid(posix_geteuid())["name"], " ", getenv("COMPOSER_CACHE_DIR"), " ", getcwd();']);
    expect(result).toEqual(expect.objectContaining({ ok: true, mode: 'run' }));
    expect(result.output.trim().split('\n')[0]).toMatch(/^phpapp \/cache\/composer \/app/);
    const argv = await octopod.shellCommand('phpapp', { service: 'cli', command: ['php', '-v'], tty: false });
    expect(argv).toContain('run');
    // Its cache kept in the project, the operator's — not in Docker's storage.
    expect((await stat(join(root, '.octopod', 'data', 'cli-cache', 'probe'))).uid).toBe(process.getuid?.());
    // Nothing left running of it.
    expect((await octopod.status('phpapp')).services.filter((x) => x.service === 'cli')).toEqual([{ service: 'cli', state: 'tool' }]);
  });

  it('runs a program dropped in the supervisor_d folder once reloaded, the others untouched', async () => {
    await writeFile(
      join(root, 'docker', 'supervisor', 'ticker.conf'),
      '[program:ticker]\ncommand=php -r "while (true) sleep(60);"\ndirectory=/app\nautorestart=true\nstdout_logfile=/dev/stdout\nstdout_logfile_maxbytes=0\nredirect_stderr=true\n',
    );
    const pid = (await octopod.programs('phpapp')).find((p) => p.program === 'php-fpm')?.detail;
    let programs = await octopod.reload('phpapp', 'app');
    for (let i = 0; i < 20 && programs.find((p) => p.program === 'ticker')?.state !== 'RUNNING'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      programs = await octopod.programs('phpapp');
    }
    expect(programs.find((p) => p.program === 'ticker')?.state).toBe('RUNNING');
    expect(programs.find((p) => p.program === 'php-fpm')?.detail.split(',')[0]).toBe(pid?.split(',')[0]);
  });
});

describe.skipIf(!dockerAvailable())('the service recipes, together (real docker)', { timeout: 900_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-stack-'));
    root = join(base, 'stack');
    await mkdir(root);
    await writeFile(
      join(root, 'octopod.yaml'),
      [
        'services:',
        '  db: { recipe: mariadb, version: "10.11" }',
        '  cache: { recipe: redis, persist: true }',
        '  sessions: { recipe: memcached }',
        '  docs: { recipe: mongodb, version: "7.0" }',
        '  mail: { recipe: mailpit }',
        '  pma: { recipe: phpmyadmin }',
        '  me: { recipe: mongo-express }',
        '',
      ].join('\n'),
    );
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
  }, 900_000);

  afterAll(async () => {
    await octopod.unregister('stack').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 900_000);

  it('runs each one healthy, none as root, its data the operator\'s, its admin routed', async () => {
    await octopod.register(root);
    await octopod.up('stack');
    const settled = async () => {
      for (let i = 0; i < 120; i++) {
        const s = await octopod.status('stack');
        if (s.services.length === 7 && s.services.every((x) => x.state === 'running' && (!x.health || x.health === 'healthy'))) return s;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return octopod.status('stack');
    };
    const status = await settled();
    expect(status.services.map((x) => `${x.service}:${x.state}:${x.health ?? '-'}`).sort()).toEqual([
      'cache:running:healthy',
      'db:running:healthy',
      'docs:running:healthy',
      'mail:running:healthy',
      'me:running:-',
      'pma:running:-',
      'sessions:running:healthy',
    ]);
    expect(status.warnings ?? []).toEqual([]);
    for (const volume of ['db-data', 'cache-data', 'docs-data']) {
      expect((await stat(join(root, '.octopod', 'data', volume))).uid, volume).toBe(process.getuid?.());
    }
    const served = async (host: string, pattern: RegExp) => {
      let last = { status: 0, body: '' };
      for (let i = 0; i < 60 && !(last.status === 200 && pattern.test(last.body)); i++) {
        last = await get(host, '/').catch(() => ({ status: 0, body: '' }));
        if (!(last.status === 200 && pattern.test(last.body))) await new Promise((r) => setTimeout(r, 1000));
      }
      return last;
    };
    // What a failing admin said, for the CI log.
    const why = async (service: string) => (await octopod.logs('stack', service, 40)).join('\n');
    const mail = await served('mail.stack.localhost', /Mailpit/i);
    if (mail.status !== 200) console.error(await why('mail'));
    expect(mail.status).toBe(200);
    // Logged in with the database's user: the page names the server it is connected to.
    const pma = await served('pma.stack.localhost', /phpMyAdmin/);
    if (pma.status !== 200) console.error(await why('pma'));
    expect(pma.body).toMatch(/db/);
    const me = await served('mongo.stack.localhost', /Mongo Express/i);
    if (me.status !== 200) console.error(await why('me'));
    expect(me.status).toBe(200);
  });
});

describe.skipIf(!dockerAvailable())('after Docker lost its networks (real docker)', { timeout: 300_000 }, () => {
  let base: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-prune-'));
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(await project(base, 'pruned', 80));
    await octopod.up('pruned');
  }, 300_000);

  afterAll(async () => {
    await octopod.unregister('pruned').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 300_000);

  it('brings the edge and a project back up, their containers made again on the new networks', async () => {
    // What a `docker network prune` does to stopped stacks: their containers stay, their
    // networks go — and starting them again would point at networks that no longer exist.
    docker('compose', '-f', join(base, 'state', 'edge', 'compose.json'), 'stop');
    docker('compose', '-p', 'pruned', 'stop');
    docker('network', 'rm', `${INSTANCE}-edge_default`, `${INSTANCE}-pruned-edge`);
    expect((await octopod.edgeUp()).running).toBe(true);
    await octopod.up('pruned');
    expect((await eventually('pruned.localhost', 200)).status).toBe(200);
  });
});

describe.skipIf(!dockerAvailable())('a recipe whose Dockerfile changes (real docker)', { timeout: 300_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;
  const dockerfile = (word: string) => `ARG BASE_IMAGE\nFROM \${BASE_IMAGE}\nRUN echo ${word} > /version\n`;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-rebuild-'));
    root = join(base, 'rebuilt');
    const recipe = join(root, '.octopod', 'recipes', 'probe');
    await mkdir(recipe, { recursive: true });
    await writeFile(join(recipe, 'recipe.yaml'), 'title: Probe\nsummary: s\nimage: alpine:3.20\nunpinned: true\nbuild: true\ncommand: [sleep, "3600"]\n');
    await writeFile(join(recipe, 'Dockerfile'), dockerfile('one'));
    await writeFile(join(root, 'octopod.yaml'), 'services:\n  app: { recipe: probe }\n');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(root);
  }, 300_000);

  afterAll(async () => {
    await octopod.unregister('rebuilt').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 300_000);

  it('is built again by up, and its container runs the new image', async () => {
    await octopod.up('rebuilt');
    expect((await octopod.exec('rebuilt', 'app', ['cat', '/version'])).output.trim()).toBe('one');
    await writeFile(join(root, '.octopod', 'recipes', 'probe', 'Dockerfile'), dockerfile('two'));
    await octopod.up('rebuilt');
    expect((await octopod.exec('rebuilt', 'app', ['cat', '/version'])).output.trim()).toBe('two');
    // The image it replaced is gone, not left nameless.
    expect(docker('image', 'ls', '-q', '--filter', 'dangling=true', '--filter', 'label=octopod.project=rebuilt').trim()).toBe('');
  });
});

describe.skipIf(!dockerAvailable())("the project's own mounted folders (real docker)", { timeout: 300_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-binds-'));
    root = join(base, 'binds');
    await mkdir(root);
    await writeFile(
      join(root, 'docker-compose.yml'),
      'services:\n  web:\n    image: traefik/whoami:v1.10\n    volumes:\n      - ./.octopod/dataset/img:/img\n      - ./made/here:/made\n      - ./rooted:/rooted\n',
    );
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n    port: 80\n');
    // What Docker does to a missing mount source when octopod is not there to make it first.
    docker('run', '--rm', '-v', `${join(root, 'rooted')}:/x`, 'alpine:3.20', 'true');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(root);
  }, 300_000);

  afterAll(async () => {
    await octopod.unregister('binds').catch(() => undefined);
    await octopod.edgeDown();
    docker('run', '--rm', '-v', `${base}:/base`, 'alpine:3.20', 'rm', '-rf', '/base/binds/rooted');
    await rm(base, { recursive: true, force: true });
  }, 300_000);

  it('creates the missing ones as the operator, and says which one root owns', async () => {
    await octopod.up('binds');
    for (const dir of ['.octopod/dataset/img', 'made/here']) expect((await stat(join(root, dir))).uid, dir).toBe(process.getuid?.());
    const status = await octopod.status('binds');
    expect(status.warnings).toContainEqual(expect.stringMatching(/^rooted is owned by uid 0, not you/));
    expect((status.warnings ?? []).filter((w) => w.startsWith('made') || w.startsWith('.octopod/dataset'))).toEqual([]);
  });
});

describe.skipIf(!dockerAvailable())('after a reboot: the relay before the API (real docker)', { timeout: 300_000 }, () => {
  let base: string;
  let octopod: Octopod;
  let socketDir: string;
  let api: Server | undefined;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-boot-'));
    socketDir = join(base, 'run');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT], socket: join(socketDir, 'octopod.sock') });
    await octopod.edgeUp();
  }, 300_000);

  afterAll(async () => {
    if (api) await new Promise((r) => api?.close(r));
    await octopod.edgeDown();
    docker('run', '--rm', '-v', `${base}:/base`, 'alpine:3.20', 'rm', '-rf', '/base/run', '/base/root-made');
    await rm(base, { recursive: true, force: true });
  }, 300_000);

  it('does not let Docker make the API folder as root; serve makes it, and starts the relay', async () => {
    // A reboot: the folder is gone (a tmpfs), and Docker starts the relay on its own.
    docker('stop', `${INSTANCE}-console`);
    await rm(socketDir, { recursive: true, force: true });
    expect(() => docker('start', `${INSTANCE}-console`)).toThrow();
    await expect(stat(socketDir)).rejects.toThrow();
    // Then octopod's service starts.
    api = await listen(octopod, join(socketDir, 'octopod.sock'));
    await octopod.ensureConsole();
    expect((await stat(socketDir)).uid).toBe(process.getuid?.());
    expect(docker('inspect', '--format', '{{.State.Running}}', `${INSTANCE}-console`).trim()).toBe('true');
  });

  it('says how to get back a folder Docker made as root, instead of a bare EPERM', async () => {
    const made = join(base, 'root-made');
    docker('run', '--rm', '-v', `${made}:/x`, 'alpine:3.20', 'true');
    await expect(prepareSocketDir(made)).rejects.toThrow(/belongs to uid 0, not you: .*sudo chown/);
  });
});

describe.skipIf(!dockerAvailable())('a Python project made of recipes (real docker)', { timeout: 900_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-py-'));
    root = join(base, 'pyapp');
    await mkdir(root);
    await writeFile(join(root, 'index.html'), 'served by python-app\n');
    await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "pyapp"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = []\n');
    await writeFile(
      join(root, 'octopod.yaml'),
      'services:\n  app:\n    recipe: python-app\n    drivers: [mysql]\n    programs:\n      web: { command: python -m http.server 8000 }\n  cache: { recipe: valkey }\n',
    );
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(root);
  }, 900_000);

  afterAll(async () => {
    await octopod.unregister('pyapp').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 900_000);

  it("serves the project's program as its user, with uv, and Valkey as its REDIS_URL", async () => {
    await octopod.up('pyapp');
    expect((await eventually('pyapp.localhost', 200)).body).toContain('served by python-app');
    const who = await octopod.exec('pyapp', 'app', ['sh', '-c', 'id -un; id -u; command -v uv; echo "$REDIS_URL"']);
    expect(who.output.trim().split('\n')).toEqual(['pyapp', String(process.getuid?.()), '/usr/local/bin/uv', 'redis://cache:6379']);
    expect((await octopod.logs('pyapp', 'app', 50)).join('\n')).toContain('python-app: no .venv yet');
    const ping = await octopod.exec('pyapp', 'app', ['python', '-c', "import socket; s = socket.create_connection(('cache', 6379)); s.sendall(b'PING\\r\\n'); print(s.recv(16).decode().strip())"]);
    expect(ping.output.trim()).toBe('+PONG');
    // The dependencies are the project's: uv sync in the running app, its .venv in the project.
    const sync = await octopod.exec('pyapp', 'app', ['uv', 'sync'], { timeoutMs: 120_000 });
    expect(sync.ok).toBe(true);
    expect((await stat(join(root, '.venv'))).uid).toBe(process.getuid?.());
    // drivers: [mysql] — what mysqlclient's build looks for, there.
    const mysql = await octopod.exec('pyapp', 'app', ['sh', '-c', 'pkg-config --exists libmariadb && command -v gcc']);
    expect(mysql.ok).toBe(true);
  });
});

describe.skipIf(!dockerAvailable())('the OIDC provider, seen from the browser and from the app (real docker)', { timeout: 600_000 }, () => {
  let base: string;
  let root: string;
  let octopod: Octopod;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-oidc-'));
    root = join(base, 'idp');
    await mkdir(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'idp', scripts: { dev: 'node -e "require(\'node:http\').createServer((q, r) => r.end(\'app\')).listen(3000)"' } }));
    await mkdir(join(root, 'node_modules'));
    // The code flow, run inside the app: every URL is the issuer's public one.
    await writeFile(
      join(root, 'flow.mjs'),
      [
        "const issuer = `${process.env.OIDC_ISSUER_BASE}/admi`;",
        "const meta = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();",
        "const login = await fetch(meta.authorization_endpoint, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: 'app', redirect_uri: 'http://idp.localhost/cb', scope: 'openid', username: 'ada', claims: '{\"groups\":[\"admi-dev\"]}' }) });",
        "const code = new URL(login.headers.get('location')).searchParams.get('code');",
        "const tokens = await (await fetch(meta.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'app', redirect_uri: 'http://idp.localhost/cb' }) })).json();",
        "const id = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());",
        "console.log(JSON.stringify({ issuer: meta.issuer, iss: id.iss, sub: id.sub, groups: id.groups }));",
        '',
      ].join('\n'),
    );
    await writeFile(join(root, 'octopod.yaml'), 'services:\n  app: { recipe: node-app }\n  id: { recipe: oidc, password-grant: true }\n');
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await octopod.register(root);
  }, 600_000);

  afterAll(async () => {
    await octopod.unregister('idp').catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 600_000);

  it('names one issuer on both sides, and signs the claims the login gave', async () => {
    await octopod.up('idp');
    await eventually('id.idp.localhost', 200, '/admi/.well-known/openid-configuration');
    // As a browser asks: its Host carries the edge's port.
    const fromHost = await get(`id.idp.localhost:${PORT}`, '/admi/.well-known/openid-configuration');
    const issuer = `http://id.idp.localhost:${PORT}/admi`;
    expect(JSON.parse(fromHost.body).issuer).toBe(issuer);
    const flow = await octopod.exec('idp', 'app', ['node', 'flow.mjs'], { timeoutMs: 60_000 });
    expect(flow.ok, flow.output).toBe(true);
    expect(JSON.parse(flow.output.trim().split('\n').pop()!)).toEqual({ issuer, iss: issuer, sub: 'ada', groups: ['admi-dev'] });
    // Its key is kept in the project, the operator's.
    expect((await stat(join(root, '.octopod', 'data', 'id-keys', 'signing-key.pem'))).uid).toBe(process.getuid?.());
  });

  it('takes a user from the host through its admin, and lets a CI in the app sign in with its password', async () => {
    const token = (await octopod.secrets('idp')).find((s) => s.service === 'id' && s.name === 'admin-token')!.value;
    const put = await get('id.idp.localhost', '/admin/api/users/ci', 'PUT', { Authorization: `Bearer ${token}` }, 5000, JSON.stringify({ claims: { groups: ['admi-staff'] }, password: 'ci-pass' }));
    expect(put.status, put.body).toBe(201);
    const grant = await octopod.exec('idp', 'app', [
      'node',
      '-e',
      "fetch(`${process.env.OIDC_ISSUER_BASE}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'ci', username: 'ci', password: 'ci-pass' }) }).then((r) => r.json()).then((t) => console.log(JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url')).groups.join()))",
    ]);
    expect(grant.output.trim()).toBe('admi-staff');
  });
});

describe.skipIf(!dockerAvailable())("a group's shared database (real docker)", { timeout: 900_000 }, () => {
  let base: string;
  let octopod: Octopod;
  const project = async (name: string) => {
    const root = join(base, name);
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name, scripts: { dev: 'node -e "require(\'node:http\').createServer((q, r) => r.end(\'ok\')).listen(3000)"' } }));
    await writeFile(join(root, 'octopod.yaml'), `project: ${name}\ngroup: gtest\nservices:\n  app: { recipe: node-app }\n  db: { recipe: mariadb, shared: true }\n`);
    await octopod.register(root);
  };
  const secret = async (name: string) => (await octopod.secrets(name)).find((s) => s.service === 'db' && s.name === 'password')!.value;
  const asTenant = (user: string, password: string, db: string) =>
    octopod.exec('gtest-shared', 'db', ['sh', '-c', `MYSQL_PWD='${password}' mariadb -u${user} -e 'SELECT 42' ${db}`], { timeoutMs: 30_000 });

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-group-'));
    octopod = new Octopod({ stateDir: join(base, 'state'), instance: INSTANCE, ports: [PORT] });
    await project('ga');
    await project('gb');
  }, 900_000);

  afterAll(async () => {
    for (const name of ['ga', 'gb', 'gc', 'gtest-shared']) await octopod.unregister(name).catch(() => undefined);
    await octopod.edgeDown();
    await rm(base, { recursive: true, force: true });
  }, 900_000);

  it('runs one server for the group, a database and a user for each project, walled off', async () => {
    await octopod.up('ga');
    await octopod.up('gb');
    expect(await octopod.names()).toContain('gtest-shared');
    const [a, b] = [await secret('ga'), await secret('gb')];
    expect(a).not.toBe(b);
    const own = await asTenant('ga', a, 'ga');
    expect(own.ok, own.output).toBe(true);
    expect(own.output).toContain('42');
    const other = await asTenant('ga', a, 'gb');
    expect(other.ok).toBe(false);
    expect(other.output).toMatch(/denied/i);
    // The app reaches the group's server by its name, with its own URL.
    const reach = await octopod.exec('ga', 'app', ['node', '-e', "const u = new URL(process.env.DATABASE_URL); require('node:net').connect(3306, u.hostname).on('connect', function () { console.log(u.username, u.pathname); this.end(); })"]);
    expect(reach.output.trim()).toBe('ga /ga');
    // The group's network is the shared services', not a way from one project to another.
    const across = await octopod.exec('ga', 'app', ['node', '-e', "require('node:net').connect(3000, 'gb-app-1').on('connect', () => console.log('reached')).on('error', (e) => console.log('blocked', e.code))"]);
    expect(across.output.trim()).toMatch(/^blocked/);
    // Its data is the group's, in octopod's state, owned by the operator.
    expect((await stat(join(base, 'state', 'groups', 'gtest', '.octopod', 'data', 'db-data'))).uid).toBe(process.getuid?.());
  });

  it("takes away a project's own server once the group's replaces it", async () => {
    const root = join(base, 'gc');
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'gc', scripts: { dev: 'node -e "require(\'node:http\').createServer((q, r) => r.end(\'ok\')).listen(3000)"' } }));
    await writeFile(join(root, 'octopod.yaml'), 'project: gc\ngroup: gtest\nservices:\n  app: { recipe: node-app }\n  db: { recipe: mariadb }\n');
    await octopod.register(root);
    await octopod.up('gc');
    expect(docker('ps', '--format', '{{.Names}}')).toContain('gc-db-1');
    await writeFile(join(root, 'octopod.yaml'), 'project: gc\ngroup: gtest\nservices:\n  app: { recipe: node-app }\n  db: { recipe: mariadb, shared: true }\n');
    await octopod.up('gc');
    expect(docker('ps', '-a', '--format', '{{.Names}}')).not.toContain('gc-db-1');
    // Its volume object too, a pointer to its data, which stays in the project.
    expect(docker('volume', 'ls', '--format', '{{.Name}}').split('\n')).not.toContain('gc_db-data');
    expect((await stat(join(root, '.octopod', 'data', 'db-data'))).isDirectory()).toBe(true);
    await octopod.unregister('gc');
  });

  it('keeps the server while a project of the group runs, and stops it with the last one', async () => {
    const running = async () => (await octopod.status('gtest-shared')).services.some((s) => s.state === 'running');
    await octopod.down('ga');
    expect(await running()).toBe(true);
    await octopod.down('gb');
    expect(await running()).toBe(false);
  });
});
