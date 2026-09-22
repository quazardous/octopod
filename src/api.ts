/**
 * The API: HTTP with JSON bodies over a unix socket only the user can open. Routes map
 * one to one onto the Octopod operations; errors are `{ error }` with a 4xx/5xx status.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DeclarationError } from './declaration.js';
import { DockerError } from './docker.js';
import { defaultSocket, Octopod, OctopodError } from './octopod.js';

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
const CONSOLE_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/console.js': { file: 'console.js', type: 'text/javascript; charset=utf-8' },
  '/console.css': { file: 'console.css', type: 'text/css; charset=utf-8' },
};
const CONSOLE_DIR = new URL('../console/', import.meta.url);

async function sendConsole(res: ServerResponse, file: { file: string; type: string }): Promise<void> {
  res.writeHead(200, {
    'content-type': file.type,
    'cache-control': 'no-store',
    // Its own files, its own API, nothing else — and never inside another site's frame.
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(await readFile(new URL(file.file, CONSOLE_DIR)));
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
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

      if (resource === 'edge' && !name && method === 'GET') return send(res, 200, await octopod.edgeStatus());
      if (resource === 'edge' && name === 'up' && method === 'POST') return send(res, 200, await octopod.edgeUp());
      if (resource === 'edge' && name === 'down' && method === 'POST') return send(res, 200, await octopod.edgeDown());

      if (resource === 'projects' && !name && method === 'GET') return send(res, 200, await octopod.list());
      if (resource === 'recipes' && !name && method === 'GET') {
        const root = url.searchParams.get('root');
        if (root !== null && !root.startsWith('/')) return send(res, 400, { error: '"root" must be an absolute path' });
        return send(res, 200, await octopod.recipes(root ?? undefined));
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
        return send(res, 200, await octopod.down(name, { volumes: volumes === true, instance: instanceValue(instance) }));
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

/** Listen on the socket, in a directory only the user can enter. */
export async function listen(octopod: Octopod, socket = defaultSocket()): Promise<Server> {
  await mkdir(dirname(socket), { recursive: true, mode: 0o700 });
  await chmod(dirname(socket), 0o700);
  await rm(socket, { force: true });
  const server = createServer((req, res) => void handler(octopod)(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  await chmod(socket, 0o600);
  return server;
}
