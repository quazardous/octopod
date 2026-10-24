/**
 * The provider over HTTP. Every first path segment is an issuer: `/admi/...` and
 * `/google/...` are two, with nothing to declare. The issuer's URL is the address the
 * request came to (its Host, behind the edge), so it is the same for a browser on the host
 * and for a container of the project that reaches the same host.
 *
 *   PORT        where it listens (8080)
 *   OIDC_DATA   where the signing key is kept (/data); made on first start
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newKeyPem, Provider, type AuthRequest } from './provider.js';

const ISSUER = /^\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
/** What the login page passes back, beside the user name and claims. */
const REQUEST_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(text);
}

async function form(req: IncomingMessage): Promise<Record<string, string>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('request too large');
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** The client id of a `client_secret_basic` Authorization header; the secret is not checked. */
function basicClientId(header: string | undefined): string | undefined {
  const value = /^Basic\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!value) return undefined;
  return decodeURIComponent(Buffer.from(value, 'base64').toString().split(':')[0] ?? '');
}

function loginPage(issuer: string, query: Record<string, string>, error = ''): string {
  const hidden = REQUEST_FIELDS.filter((f) => query[f]).map((f) => `<input type="hidden" name="${f}" value="${escape(query[f]!)}">`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sign in</title>
<style>body{font:15px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:1rem 0 .3rem}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.4rem}textarea{font-family:monospace;height:7rem}button{margin-top:1rem;padding:.5rem 1.2rem;font:inherit}.error{color:#b00}small{color:#666}</style>
<h1>Sign in</h1>
<p><small>${escape(issuer)} — a development provider: any user, the claims you write.</small></p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
<form method="post">${hidden}
<label for="username">User</label><input id="username" name="username" value="${escape(query.username ?? 'dev')}" required>
<label for="claims">Claims (JSON)</label><textarea id="claims" name="claims">${escape(query.claims ?? '{\n  "email": "dev@example.test",\n  "groups": []\n}')}</textarea>
<button type="submit">Sign in</button></form>`;
}

export function handler(provider: Provider) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    const match = ISSUER.exec(url.pathname);
    if (!match) return send(res, 404, { error: 'not_found', error_description: 'an issuer is a path: /<name>/.well-known/openid-configuration' });
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
    const issuer = `${proto}://${req.headers.host}/${match[1]}`;
    const path = match[2] ?? '';
    const query = Object.fromEntries(url.searchParams);
    try {
      if (path === '/.well-known/openid-configuration' && req.method === 'GET') return send(res, 200, provider.discovery(issuer));
      if (path === '/jwks' && req.method === 'GET') return send(res, 200, provider.jwks());
      if (path === '/authorize' && req.method === 'GET') {
        const request = provider.authorizeRequest(issuer, query);
        if ('error' in request) return send(res, 400, { error: 'invalid_request', error_description: request.error });
        return send(res, 200, loginPage(issuer, query));
      }
      if (path === '/authorize' && req.method === 'POST') {
        const fields = await form(req);
        const request = provider.authorizeRequest(issuer, fields);
        if ('error' in request) return send(res, 400, { error: 'invalid_request', error_description: request.error });
        let claims: unknown;
        try {
          claims = JSON.parse(fields.claims || '{}');
        } catch {
          claims = undefined;
        }
        if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return send(res, 400, loginPage(issuer, fields, 'The claims must be a JSON object.'));
        const sub = (fields.username ?? '').trim();
        if (!sub) return send(res, 400, loginPage(issuer, fields, 'A user name is needed.'));
        return send(res, 302, '', { location: provider.issueCode(request as AuthRequest, { sub, claims: claims as Record<string, unknown> }) });
      }
      if (path === '/token' && req.method === 'POST') {
        const answer = provider.token(issuer, await form(req), basicClientId(req.headers.authorization));
        return send(res, answer.status, answer.body);
      }
      if (path === '/userinfo' && (req.method === 'GET' || req.method === 'POST')) {
        const answer = provider.userinfo(issuer, req.headers.authorization);
        return send(res, answer.status, answer.body, answer.status === 401 ? { 'www-authenticate': 'Bearer error="invalid_token"' } : {});
      }
      if (path === '/logout' && req.method === 'GET') {
        const back = query.post_logout_redirect_uri;
        if (back && /^https?:\/\//.test(back)) return send(res, 302, '', { location: back });
        return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Signed out</title><p>Signed out.</p>');
      }
      return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path || '/'} on an issuer` });
    } catch (e) {
      return send(res, 400, { error: 'invalid_request', error_description: (e as Error).message });
    }
  };
}

/** The provider's key, from the data folder; made there, readable by its owner alone, the first time. */
export function loadKey(dir: string): string {
  const file = join(dir, 'signing-key.pem');
  try {
    return readFileSync(file, 'utf8');
  } catch {
    mkdirSync(dir, { recursive: true });
    const pem = newKeyPem();
    writeFileSync(file, pem, { mode: 0o600 });
    return pem;
  }
}

export function start(port = Number(process.env.PORT ?? 8080), dir = process.env.OIDC_DATA ?? '/data'): Server {
  const server = createServer(handler(new Provider(loadKey(dir))));
  server.listen(port, () => console.log(`oidc: listening on ${port}; issuers at /<name>`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = start();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
}
