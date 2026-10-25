/**
 * The API: HTTP with JSON bodies over a unix socket only the user can open — on Windows,
 * over loopback with a token. Routes map one to one onto the Octopod operations; errors are
 * `{ error }` with a 4xx/5xx status.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmod, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DeclarationError } from './declaration.js';
import { DockerError } from './docker.js';
import { sessionCookie, sessionsOf } from './consoleAccess.js';
import { CONSOLE_HEADER, LOST_HEADER, VIA_HEADER } from './generate.js';
import { EDGE_DOMAIN, movedTo } from './names.js';
import { defaultSocket, Octopod, OctopodError, prepareSocketDir, TOKEN_HEADER, version, type ApiTcp } from './octopod.js';

export { defaultSocket };

const MAX_BODY = 64 * 1024;

/** An instance number from a body or a query: 1 when absent, refused when not a whole number from 1. */
function instanceValue(raw: unknown): number {
  if (raw === undefined || raw === null) return 1;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new OctopodError('"instance" must be a whole number from 1 to 99');
  return n;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > MAX_BODY) throw new OctopodError('request body too large');
  }
  if (text.trim() === '') return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OctopodError('the body must be a JSON object');
  return parsed as Record<string, unknown>;
}

/** The console's files, served at the root: the page and what it loads, nothing else. */
const CONSOLE_FILES: Record<string, { file: string; type: string; icon?: true }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/console.js': { file: 'console.js', type: 'text/javascript; charset=utf-8' },
  '/console.css': { file: 'console.css', type: 'text/css; charset=utf-8' },
  // The tray's tako: the SVG the page names, asleep and grey when the edge is stopped, and
  // the .ico a browser asks for on its own.
  '/favicon.svg': { file: '../assets/octopod.svg', type: 'image/svg+xml', icon: true },
  '/favicon-down.svg': { file: '../assets/octopod-down.svg', type: 'image/svg+xml', icon: true },
  '/favicon.ico': { file: '../assets/octopod.ico', type: 'image/x-icon', icon: true },
  // Traefik's own logo, from its dashboard, on the link to it.
  '/traefik.png': { file: '../assets/traefik-32.png', type: 'image/png', icon: true },
};
const CONSOLE_DIR = new URL('../console/', import.meta.url);

async function sendConsole(res: ServerResponse, file: { file: string; type: string; icon?: true }): Promise<void> {
  res.writeHead(200, {
    'content-type': file.type,
    // The icons may be kept: the page shows the grey one when the edge is stopped, which is
    // when nothing can be fetched through it.
    'cache-control': file.icon ? 'max-age=86400' : 'no-store',
    // Its own files, its own API, nothing else — and never inside another site's frame.
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(await readFile(new URL(file.file, CONSOLE_DIR)));
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The edge's answer for a name it routes nowhere: a 404 that says so, and where a name of the
 * old addressing (before 0.7.0) went. HTML for a browser, text for anything else.
 */
function sendLost(req: IncomingMessage, res: ServerResponse, host: string, moved: string | undefined): void {
  const html = (req.headers.accept ?? '').includes('text/html');
  const lines = moved
    ? [`${host} is an address of before octopod 0.7.0: it is now ${moved}`, `Every address moved under ${EDGE_DOMAIN}. Update what keeps the old name: ALLOWED_HOSTS, CSRF origins, OIDC redirect URIs, scripts.`]
    : [`No route for ${host}.`, "If it is a project's, is the project up? octopod status lists its addresses."];
  res.writeHead(404, {
    'content-type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
  });
  if (!html) return void res.end(`${lines.join('\n')}\n`);
  const link = moved ? escapeHtml(moved) : '';
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Not here</title><body style="font:16px system-ui;margin:3rem;max-width:40rem">` +
      (moved
        ? `<h1>Moved</h1><p><code>${escapeHtml(host)}</code> is an address of before octopod 0.7.0. It is now <a href="${link}">${link}</a>.</p><p>${escapeHtml(lines[1]!)}</p>`
        : `<h1>No route</h1><p>The edge routes nothing at <code>${escapeHtml(host)}</code>.</p><p>${escapeHtml(lines[1]!)}</p>`),
  );
}

function send(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

export function handler(octopod: Octopod) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://octopod');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';
    try {
      const page = CONSOLE_FILES[url.pathname];
      if (page && (method === 'GET' || method === 'HEAD')) return await sendConsole(res, page);
      if (parts[0] !== 'v1') return send(res, 404, { error: 'not found' });
      const [, resource, name, action] = parts;

      // Through the console's relay: an enrolled browser, or nothing but the enrollment.
      const viaConsole = req.headers[VIA_HEADER.toLowerCase()] !== undefined;
      const sessions = sessionsOf(req.headers.cookie);
      if (viaConsole && resource === 'console' && name === 'enroll' && method === 'POST') {
        const { code } = await body(req);
        const opened = typeof code === 'string' ? await octopod.access.enroll(code) : null;
        if (!opened) return send(res, 403, { error: 'wrong or expired code: run octopod console code for a new one' });
        return send(res, 200, {}, { 'set-cookie': sessionCookie(opened) });
      }
      if (viaConsole && resource === 'console' && name === 'signout' && method === 'POST') {
        for (const session of sessions) await octopod.access.signOut(session);
        return send(res, 200, {}, { 'set-cookie': sessionCookie(null) });
      }
      // A name the edge routes nowhere, from the relay's last resort: no enrollment needed, it
      // says no more than where an old name of a project went.
      if (resource === 'lost' && !name && (method === 'GET' || method === 'HEAD')) {
        const host = String(req.headers[LOST_HEADER.toLowerCase()] ?? '').slice(0, 253);
        return sendLost(req, res, host, movedTo(host, await octopod.list()));
      }
      if (viaConsole && !(await Promise.all(sessions.map((s) => octopod.access.valid(s)))).some(Boolean)) {
        return send(res, 401, { error: 'this browser is not enrolled in the console', enroll: true });
      }
      // A code, or the end of every session: the operator's, on the socket, never the console's.
      if (resource === 'console' && name === 'code' && method === 'POST' && !viaConsole) return send(res, 200, await octopod.access.code());
      if (resource === 'console' && name === 'sessions' && method === 'DELETE' && !viaConsole) return send(res, 200, { closed: await octopod.access.revoke() });

      if (resource === 'version' && !name && method === 'GET') return send(res, 200, await version());

      if (resource === 'edge' && !name && method === 'GET') return send(res, 200, await octopod.edgeStatus());
      if (resource === 'edge' && name === 'up' && method === 'POST') return send(res, 200, await octopod.edgeUp());
      if (resource === 'edge' && name === 'down' && method === 'POST') return send(res, 200, await octopod.edgeDown());

      if (resource === 'projects' && !name && method === 'GET') {
        return send(res, 200, await octopod.list({ group: url.searchParams.get('group') ?? undefined, tag: url.searchParams.get('tag') ?? undefined }));
      }
      if (resource === 'recipes' && !name && method === 'GET') {
        const root = url.searchParams.get('root');
        if (root !== null && !root.startsWith('/')) return send(res, 400, { error: '"root" must be an absolute path' });
        return send(res, 200, await octopod.recipes(root ?? undefined));
      }
      if (resource === 'recipes' && name && action === 'icon' && method === 'GET') {
        // An SVG of a recipe's folder: an image only, whatever it holds — no script runs from it.
        const svg = await octopod.recipeIcon(name, url.searchParams.get('project') ?? undefined);
        res.writeHead(200, {
          'content-type': 'image/svg+xml',
          'cache-control': 'max-age=3600',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        res.end(svg);
        return;
      }
      if (resource === 'plan' && !name && method === 'POST') {
        const { root, instance } = await body(req);
        if (typeof root !== 'string' || !root.startsWith('/')) return send(res, 400, { error: '"root" must be an absolute path' });
        return send(res, 200, await octopod.plan(root, instanceValue(instance)));
      }
      if (resource === 'projects' && !name && method === 'POST') {
        const { root } = await body(req);
        if (typeof root !== 'string' || !root.startsWith('/')) return send(res, 400, { error: '"root" must be an absolute path' });
        return send(res, 201, await octopod.register(root));
      }
      // Instance N of a project: `instance` in the body, or in the query of a GET.
      const queryInstance = (): number => instanceValue(url.searchParams.get('instance') ?? undefined);
      if (resource === 'projects' && name && !action && method === 'GET') return send(res, 200, await octopod.status(name, queryInstance()));
      if (resource === 'projects' && name && !action && method === 'DELETE') {
        await octopod.unregister(name);
        return send(res, 200, {});
      }
      if (resource === 'projects' && name && action === 'up' && method === 'POST') {
        const { instance } = await body(req);
        return send(res, 200, await octopod.up(name, instanceValue(instance)));
      }
      if (resource === 'projects' && name && action === 'down' && method === 'POST') {
        const { volumes, instance } = await body(req);
        // The console stops a project, it never deletes its data.
        if (volumes === true && req.headers[CONSOLE_HEADER.toLowerCase()] !== undefined) return send(res, 403, { error: 'the console does not remove volumes: octopod down --volumes' });
        return send(res, 200, await octopod.down(name, { volumes: volumes === true, instance: instanceValue(instance) }));
      }
      if (resource === 'disk' && !name && method === 'GET') return send(res, 200, await octopod.disk());
      if (resource === 'build-cache' && name === 'prune' && method === 'POST') return send(res, 200, { freed: await octopod.pruneBuildCache() });
      if (resource === 'projects' && name && action === 'disk' && method === 'GET') {
        return send(res, 200, await octopod.disk(name, url.searchParams.has('instance') ? queryInstance() : undefined));
      }
      if (resource === 'projects' && name && action === 'prune' && method === 'POST') {
        const { service } = await body(req);
        return send(res, 200, await octopod.prune(name, { service: typeof service === 'string' ? service : undefined }));
      }
      if (resource === 'projects' && name && action === 'destroy' && method === 'POST') {
        // The console never deletes data, whatever the relay let through.
        if (viaConsole) return send(res, 403, { error: 'the console does not destroy data: octopod destroy' });
        const { service, keepSecrets, confirm } = await body(req);
        return send(res, 200, await octopod.destroy(name, { service: typeof service === 'string' ? service : undefined, keepSecrets: keepSecrets === true, confirm: confirm === true }));
      }
      if (resource === 'projects' && name && action === 'restart' && method === 'POST') {
        const { service, instance } = await body(req);
        return send(res, 200, await octopod.restart(name, typeof service === 'string' ? service : undefined, instanceValue(instance)));
      }
      if (resource === 'projects' && name && action === 'exec' && method === 'POST') {
        const { service, argv, timeoutMs, instance } = await body(req);
        if (typeof service !== 'string' || !Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
          return send(res, 400, { error: '"service" must be a string and "argv" an array of strings' });
        }
        const timeout = typeof timeoutMs === 'number' ? Math.min(Math.max(timeoutMs, 1000), 600_000) : undefined;
        return send(res, 200, await octopod.exec(name, service, argv as string[], { timeoutMs: timeout, instance: instanceValue(instance) }));
      }
      if (resource === 'projects' && name && action === 'secrets' && method === 'GET') {
        const raw = url.searchParams.get('instance');
        const secrets = await octopod.secrets(name, raw === null ? undefined : instanceValue(raw));
        return send(res, 200, { values: [...new Set(secrets.map((s) => s.value))] });
      }
      if (resource === 'projects' && name && action === 'actions' && method === 'GET') return send(res, 200, await octopod.actions(name, queryInstance()));
      if (resource === 'projects' && name && action === 'run' && method === 'POST') {
        // Files, not bodies: a dump goes from the container to a file the client names, streamed.
        const { service, action: what, input, output, confirm, instance } = await body(req);
        const path = (p: unknown) => p === undefined || (typeof p === 'string' && p.startsWith('/'));
        if (typeof service !== 'string' || typeof what !== 'string' || !path(input) || !path(output)) {
          return send(res, 400, { error: '"service" and "action" must be strings, "input" and "output" absolute paths' });
        }
        return send(
          res,
          200,
          await octopod.runAction(name, service, what, { instance: instanceValue(instance), input: input as string | undefined, output: output as string | undefined, confirm: confirm === true }),
        );
      }
      if (resource === 'projects' && name && action === 'programs' && method === 'GET') return send(res, 200, await octopod.programs(name, queryInstance()));
      if (resource === 'projects' && name && action === 'program' && method === 'POST') {
        const { service, program, action: what, instance } = await body(req);
        if (what === 'reload' && typeof service === 'string') return send(res, 200, await octopod.reload(name, service, instanceValue(instance)));
        if (typeof service !== 'string' || typeof program !== 'string' || !['start', 'stop', 'restart'].includes(what as string)) {
          return send(res, 400, { error: '"service" and "program" must be strings, "action" one of start, stop, restart — or "reload" with a "service"' });
        }
        return send(res, 200, await octopod.program(name, service, program, what as 'start' | 'stop' | 'restart', instanceValue(instance)));
      }
      if (resource === 'projects' && name && action === 'info' && method === 'GET') {
        const service = url.searchParams.get('service');
        if (!service) return send(res, 400, { error: '"service" is required' });
        return send(res, 200, await octopod.info(name, service, queryInstance()));
      }
      if (resource === 'projects' && name && action === 'logs' && method === 'GET') {
        const tail = Math.min(Math.max(Number(url.searchParams.get('tail') ?? 200) || 200, 1), 5000);
        return send(res, 200, { lines: await octopod.logs(name, url.searchParams.get('service') ?? undefined, tail, queryInstance()) });
      }
      return send(res, 404, { error: `no route ${method} ${url.pathname}` });
    } catch (e) {
      const status = e instanceof DeclarationError || e instanceof SyntaxError ? 400 : e instanceof OctopodError ? 409 : e instanceof DockerError ? 502 : 500;
      return send(res, status, { error: (e as Error).message });
    }
  };
}

/**
 * Listen on the socket, in a directory only the user can enter — or, where there are no unix
 * sockets (Windows), on the loopback port of `api.json`, answering only requests that carry
 * its token.
 */
export async function listen(octopod: Octopod, socket = defaultSocket()): Promise<Server> {
  if (octopod.tcp) return listenTcp(octopod, await octopod.apiTcp());
  await prepareSocketDir(dirname(socket));
  await rm(socket, { force: true });
  const server = createServer((req, res) => void handler(octopod)(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  await chmod(socket, 0o600);
  return server;
}

async function listenTcp(octopod: Octopod, api: ApiTcp): Promise<Server> {
  const expected = Buffer.from(api.token);
  const serve = handler(octopod);
  const server = createServer((req, res) => {
    // Any process of the machine can open the port, and any web page send it a GET: only
    // the token tells the console relay (and the operator's own tools) from them.
    const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(res, 401, { error: `the API wants the token of api.json in ${TOKEN_HEADER}` });
    void serve(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(api.port, '127.0.0.1', resolve);
  });
  return server;
}
