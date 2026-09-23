/**
 * Against real Docker: two projects behind one edge. Uses its own instance prefix and
 * port, so it never touches a real octopod edge. Skipped when Docker is not available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { listen } from './api.js';
import { Octopod } from './octopod.js';

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

async function get(host: string, path = '/', method = 'GET'): Promise<{ status: number; body: string }> {
  // Node's fetch refuses to set Host; a plain request to the edge with the header does it.
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: host }, timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    // The option only says the time is up: the request must be ended here, or a route to a
    // service that just went down can keep it open for ever.
    req.on('timeout', () => req.destroy(new Error(`no answer from ${host} within 3 s`)));
    req.on('error', reject);
    req.end();
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
    const projects = JSON.parse((await eventually('octopod.localhost', 200, '/v1/projects')).body) as { name: string }[];
    expect(projects.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
    expect(JSON.parse((await get('octopod.localhost', '/v1/edge')).body)).toEqual(expect.objectContaining({ running: true, console: `http://octopod.localhost:${PORT}` }));
  });

  it('refuses anything but reading through the console', async () => {
    // Up to the API's socket, this would take the project down: the relay stops it first.
    expect((await get('octopod.localhost', '/v1/projects/alpha/down', 'POST')).status).toBe(403);
    // Nor the secrets octopod generated: they are for local clients, on the socket.
    expect((await get('octopod.localhost', '/v1/projects/alpha/secrets')).status).toBe(403);
    expect((await get('octopod.localhost', '/v1/projects/alpha/%73ecrets')).status).toBe(403);
    expect((await octopod.status('alpha')).services).toEqual([expect.objectContaining({ state: 'running' })]);
  });

  it('keeps the console and the dashboard from the projects\' containers', async () => {
    await eventually('octopod.localhost', 200);
    // From a project's edge network, where its containers reach the edge. A raw request
    // (busybox wget sends its own Host header before any given one), its input kept open
    // until the answer is in: a closed one reads to Traefik as a client gone (499).
    const from = (host: string): string =>
      execFileSync('docker', ['run', '--rm', '--network', 'octopodtest-alpha-edge', 'alpine:3.20', 'sh', '-c', `(printf 'GET / HTTP/1.0\\r\\nHost: ${host}\\r\\n\\r\\n'; sleep 3) | nc -w 5 ${INSTANCE}-edge 80 | head -1`], { encoding: 'utf8' });
    expect(from('octopod.localhost')).toMatch(/403/);
    expect(from('traefik.localhost')).toMatch(/403/);
    expect(from('alpha.localhost')).toMatch(/200/);
    // From the host, both answer.
    expect((await eventually('traefik.localhost', 302)).status).toBe(302);
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
    expect(status.compose.map((f) => f.split('/').pop())).toEqual(['docker-compose.yml', 'docker-compose.override.yml']);
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
    await writeFile(join(root, 'octopod.yaml'), 'services:\n  app: { recipe: node-app }\n  db: { recipe: postgres }\n');
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

  it('removes what it built when the project is unregistered, and keeps the data', async () => {
    await octopod.unregister('delta');
    expect(docker('images', '--format', '{{.Repository}}').split('\n')).not.toEqual(expect.arrayContaining(['delta-app']));
    expect(docker('volume', 'ls', '--format', '{{.Name}}').split('\n')).not.toContain('delta_db-data');
    expect((await stat(join(root, '.octopod', 'data', 'db-data', 'PG_VERSION'))).isFile()).toBe(true);
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
