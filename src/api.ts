/**
 * The API: HTTP with JSON bodies over a unix socket only the user can open. Routes map
 * one to one onto the Octopod operations; errors are `{ error }` with a 4xx/5xx status.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeclarationError } from './declaration.js';
import { DockerError } from './docker.js';
import { Octopod, OctopodError } from './octopod.js';

export function defaultSocket(): string {
  return join(process.env.XDG_RUNTIME_DIR || join(tmpdir(), `octopod-${process.getuid?.() ?? 'user'}`), 'octopod', 'octopod.sock');
}

const MAX_BODY = 64 * 1024;

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
      if (parts[0] !== 'v1') return send(res, 404, { error: 'not found' });
      const [, resource, name, action] = parts;

      if (resource === 'edge' && !name && method === 'GET') return send(res, 200, await octopod.edgeStatus());
      if (resource === 'edge' && name === 'up' && method === 'POST') return send(res, 200, await octopod.edgeUp());
      if (resource === 'edge' && name === 'down' && method === 'POST') return send(res, 200, await octopod.edgeDown());

      if (resource === 'projects' && !name && method === 'GET') return send(res, 200, await octopod.list());
      if (resource === 'projects' && !name && method === 'POST') {
        const { root } = await body(req);
        if (typeof root !== 'string' || !root.startsWith('/')) return send(res, 400, { error: '"root" must be an absolute path' });
        return send(res, 201, await octopod.register(root));
      }
      if (resource === 'projects' && name && !action && method === 'GET') return send(res, 200, await octopod.status(name));
      if (resource === 'projects' && name && !action && method === 'DELETE') {
        await octopod.unregister(name);
        return send(res, 200, {});
      }
      if (resource === 'projects' && name && action === 'up' && method === 'POST') return send(res, 200, await octopod.up(name));
      if (resource === 'projects' && name && action === 'down' && method === 'POST') {
        const { volumes } = await body(req);
        return send(res, 200, await octopod.down(name, { volumes: volumes === true }));
      }
      if (resource === 'projects' && name && action === 'logs' && method === 'GET') {
        const tail = Math.min(Math.max(Number(url.searchParams.get('tail') ?? 200) || 200, 1), 5000);
        return send(res, 200, { lines: await octopod.logs(name, url.searchParams.get('service') ?? undefined, tail) });
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
