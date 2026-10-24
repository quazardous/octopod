/**
 * The provider over HTTP. Every first path segment is an issuer: `/admi/...` and
 * `/google/...` are two, with nothing to declare. The issuer's URL is the address the
 * request came to (its Host, behind the edge), so it is the same for a browser on the host
 * and for a container of the project that reaches the same host.
 *
 *   PORT                 where it listens (8080)
 *   OIDC_DATA            where the signing key and the users are kept (/data); made on first start
 *   OIDC_ADMIN_TOKEN     the bearer token of the admin API and page (/admin); none: no admin
 *   OIDC_ADMIN_LOGIN     0 for an admin that asks for nothing (a development provider behind the
 *                        edge, which answers the machine alone); the token is asked for otherwise
 *   OIDC_ADMIN_DIR       a built admin app served at /admin/ (the qdadm one); the built-in page otherwise
 *   OIDC_OPEN_LOGIN      0 to sign in only as a user of the store; any user, any claims otherwise
 *   OIDC_PASSWORD_GRANT  1 to trade a user's name and password for tokens, with no browser
 *   OIDC_GROUPS_CLAIM    the claim a user's groups are signed in (groups)
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newKeyPem, Provider, type AuthRequest } from './provider.js';
import { adminPage } from './admin.js';
import { groupOf, passwordMatches, shown, userOf, Users, type User } from './users.js';

const ISSUER = /^\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
/** First segments that are the provider's own, not issuers. */
const RESERVED = ['admin', 'health'];
/** What the login page passes back, beside the user name and claims. */
const REQUEST_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(text);
}

async function body(req: IncomingMessage): Promise<string> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('request too large');
  }
  return raw;
}

async function form(req: IncomingMessage): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await body(req)));
}

/** The client id of a `client_secret_basic` Authorization header; the secret is not checked. */
function basicClientId(header: string | undefined): string | undefined {
  const value = /^Basic\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!value) return undefined;
  return decodeURIComponent(Buffer.from(value, 'base64').toString().split(':')[0] ?? '');
}

/** A user's groups beside its name on the login page: which role it is, at a glance. */
const inGroups = (u: User): string => (u.groups?.length ? ` <small>${escape(u.groups.join(', '))}</small>` : '');

function loginPage(issuer: string, query: Record<string, string>, users: User[], open: boolean, error = ''): string {
  const hidden = REQUEST_FIELDS.filter((f) => query[f]).map((f) => `<input type="hidden" name="${f}" value="${escape(query[f]!)}">`).join('');
  // The store's users: one click for a user without a password, its password otherwise.
  const known = users.length
    ? `<h2>Users</h2>${users
        .map((u) =>
          u.password
            ? `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><b>${escape(u.sub)}</b>${inGroups(u)} <input type="password" name="password" placeholder="password" aria-label="${escape(u.sub)}'s password" required> <button>Sign in</button></form>`
            : `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><button>Sign in as ${escape(u.sub)}</button>${inGroups(u)}</form>`,
        )
        .join('')}`
    : '';
  if (!open) {
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title>
<style>body{font:15px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem}.user{margin:.6rem 0}.error{color:#b00}small{color:#666}</style>
<h1>Sign in</h1><p><small>${escape(issuer)}</small></p>${error ? `<p class="error">${escape(error)}</p>` : ''}${known || '<p>No user may sign in here yet: add one in the admin.</p>'}`;
  }
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sign in</title>
<style>body{font:15px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:1rem 0 .3rem}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.4rem}textarea{font-family:monospace;height:7rem}button{margin-top:1rem;padding:.5rem 1.2rem;font:inherit}.error{color:#b00}small{color:#666}.user input{width:auto}.user button{margin-top:0}</style>
<h1>Sign in</h1>
<p><small>${escape(issuer)} — a development provider: any user, the claims you write.</small></p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
<form method="post">${hidden}
<label for="username">User</label><input id="username" name="username" value="${escape(query.username ?? 'dev')}" required>
<label for="claims">Claims (JSON)</label><textarea id="claims" name="claims">${escape(query.claims ?? '{\n  "email": "dev@example.test",\n  "groups": []\n}')}</textarea>
<button type="submit">Sign in</button></form>${known}`;
}

export interface HandlerOptions {
  users: Users;
  /** A built admin app (index.html and its assets), served at /admin/ instead of the built-in page. */
  adminDir?: string;
  /** The admin's bearer token; none: no admin. */
  adminToken?: string;
  /** The admin asks for nothing: its API answers without the token (still taken). */
  adminOpen?: boolean;
  /** Any user with any claims, typed on the login page: today's quick role test. */
  openLogin: boolean;
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/** A file of the built admin app; its index.html for /admin/ itself. Nothing outside its folder. */
function asset(res: ServerResponse, dir: string, path: string): void {
  if (path === '/admin') {
    res.writeHead(301, { location: '/admin/' }).end();
    return;
  }
  const root = resolve(dir);
  const file = resolve(root, `.${decodeURIComponent(path.slice('/admin'.length)) || '/'}`);
  const target = file === root || file === `${root}${sep}` ? join(root, 'index.html') : file;
  if (!target.startsWith(`${root}${sep}`) || !statSync(target, { throwIfNoEntry: false })?.isFile()) {
    send(res, 404, { error: 'not_found', error_description: path });
    return;
  }
  res
    .writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': target.endsWith('index.html') ? 'no-store' : 'max-age=86400',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
    })
    .end(readFileSync(target));
}

/** Whether a request carries the admin's token: compared in constant time. */
function admitted(header: string | undefined, token: string): boolean {
  const given = Buffer.from(/^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The admin API: the users, read and written with the admin's token. */
async function admin(req: IncomingMessage, res: ServerResponse, path: string, options: HandlerOptions): Promise<void> {
  if (!options.adminToken) return send(res, 404, { error: 'not_found', error_description: 'no admin: OIDC_ADMIN_TOKEN is not set' });
  if (!path.startsWith('/admin/api/') && req.method === 'GET') {
    if (options.adminDir) return asset(res, options.adminDir, path);
    if (path === '/admin' || path === '/admin/') return send(res, 200, adminPage(), { 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
  }
  // What the admin app asks before it shows its login: whether there is one.
  // Open, it gives its token too: the login form fills itself in, one click signs in.
  if (path === '/admin/api/session' && req.method === 'GET') return send(res, 200, options.adminOpen ? { open: true, token: options.adminToken } : { open: false });
  if (!options.adminOpen && !admitted(req.headers.authorization, options.adminToken)) return send(res, 401, { error: 'unauthorized', error_description: 'the admin token is needed (Authorization: Bearer …)' }, { 'www-authenticate': 'Bearer' });
  if (path === '/admin/api/users' && req.method === 'GET') {
    const users = options.users.all().map(shown);
    return send(res, 200, { users, total: users.length });
  }
  if (path === '/admin/api/users' && req.method === 'POST') {
    // Made by name, as a PUT to its own path: what a list's "create" sends.
    let input: { sub?: unknown };
    try {
      input = JSON.parse((await body(req)) || '{}') as { sub?: unknown };
    } catch {
      return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
    }
    const sub = typeof input.sub === 'string' ? input.sub : '';
    if (options.users.get(sub)) return send(res, 409, { error: 'conflict', error_description: `user ${sub} exists` });
    const next = userOf(sub, input);
    if ('error' in next) return send(res, 400, { error: 'invalid_request', error_description: next.error });
    options.users.put(next);
    return send(res, 201, shown(next));
  }
  if (path.startsWith('/admin/api/groups')) return groupsApi(req, res, path, options);
  const one = /^\/admin\/api\/users\/([^/]+)$/.exec(path);
  if (!one) return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path}` });
  const sub = decodeURIComponent(one[1]!);
  const user = options.users.get(sub);
  if (req.method === 'GET') return user ? send(res, 200, shown(user)) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
  if (req.method === 'DELETE') return options.users.delete(sub) ? send(res, 200, { deleted: sub }) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
  if (req.method === 'PUT') {
    let input: unknown;
    try {
      input = JSON.parse((await body(req)) || '{}');
    } catch {
      return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
    }
    const next = userOf(sub, input, user);
    if ('error' in next) return send(res, 400, { error: 'invalid_request', error_description: next.error });
    options.users.put(next);
    return send(res, user ? 200 : 201, shown(next));
  }
  return send(res, 405, { error: 'method_not_allowed', error_description: `${req.method} on a user: GET, PUT or DELETE` });
}

/** The groups: their claims, their members; a group away leaves its members' groups. */
async function groupsApi(req: IncomingMessage, res: ServerResponse, path: string, options: HandlerOptions): Promise<void> {
  const users = options.users;
  const shownGroup = (name: string) => ({ ...users.group(name)!, members: users.members(name) });
  const parsed = async (): Promise<Record<string, unknown> | undefined> => {
    try {
      return JSON.parse((await body(req)) || '{}') as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  if (path === '/admin/api/groups' && req.method === 'GET') {
    const groups = users.groups().map((g) => shownGroup(g.name));
    return send(res, 200, { groups, total: groups.length });
  }
  const save = async (name: string, previous?: { name: string }, status = 200) => {
    const input = await parsed();
    if (!input) return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
    const next = groupOf(name, input, previous ? users.group(previous.name) : undefined);
    if ('error' in next) return send(res, 400, { error: 'invalid_request', error_description: next.error });
    users.putGroup(next);
    if (Array.isArray(input.members) && input.members.every((m) => typeof m === 'string')) users.setMembers(name, input.members as string[]);
    return send(res, status, shownGroup(name));
  };
  if (path === '/admin/api/groups' && req.method === 'POST') {
    // A create, as a PUT to its own path: what a list's "create" sends.
    const input = await parsed();
    const name = typeof input?.name === 'string' ? input.name : '';
    if (users.group(name)) return send(res, 409, { error: 'conflict', error_description: `group ${name} exists` });
    const next = groupOf(name, input);
    if ('error' in next) return send(res, 400, { error: 'invalid_request', error_description: next.error });
    users.putGroup(next);
    if (Array.isArray(input?.members)) users.setMembers(name, (input.members as unknown[]).filter((m): m is string => typeof m === 'string'));
    return send(res, 201, shownGroup(name));
  }
  const one = /^\/admin\/api\/groups\/([^/]+)$/.exec(path);
  if (!one) return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path}` });
  const name = decodeURIComponent(one[1]!);
  const group = users.group(name);
  if (req.method === 'GET') return group ? send(res, 200, shownGroup(name)) : send(res, 404, { error: 'not_found', error_description: `no group ${name}` });
  if (req.method === 'DELETE') return users.deleteGroup(name) ? send(res, 200, { deleted: name }) : send(res, 404, { error: 'not_found', error_description: `no group ${name}` });
  if (req.method === 'PUT') return save(name, group, group ? 200 : 201);
  return send(res, 405, { error: 'method_not_allowed', error_description: `${req.method} on a group: GET, PUT or DELETE` });
}

export function handler(provider: Provider, options: HandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return admin(req, res, url.pathname, options).catch((e: Error) => send(res, 400, { error: 'invalid_request', error_description: e.message }));
    }
    const match = ISSUER.exec(url.pathname);
    if (!match || RESERVED.includes(match[1]!)) return send(res, 404, { error: 'not_found', error_description: 'an issuer is a path: /<name>/.well-known/openid-configuration' });
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
        return send(res, 200, loginPage(issuer, query, options.users.of(match[1]!), options.openLogin));
      }
      if (path === '/authorize' && req.method === 'POST') {
        const fields = await form(req);
        const request = provider.authorizeRequest(issuer, fields);
        if ('error' in request) return send(res, 400, { error: 'invalid_request', error_description: request.error });
        const users = options.users.of(match[1]!);
        const page = (error: string) => send(res, 400, loginPage(issuer, fields, users, options.openLogin, error));
        if (fields.as !== undefined) {
          // A user of the store: its claims, and its password when it has one.
          const user = users.find((u) => u.sub === fields.as);
          if (!user || (user.password && !passwordMatches(user.password, fields.password ?? ''))) return page('Wrong user or password.');
          return send(res, 302, '', { location: provider.issueCode(request as AuthRequest, { sub: user.sub, claims: options.users.claimsOf(user) }) });
        }
        if (!options.openLogin) return page('Sign in as one of the users.');
        let claims: unknown;
        try {
          claims = JSON.parse(fields.claims || '{}');
        } catch {
          claims = undefined;
        }
        if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return page('The claims must be a JSON object.');
        const sub = (fields.username ?? '').trim();
        if (!sub) return page('A user name is needed.');
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
  const users = new Users(join(dir, 'users.json'), process.env.OIDC_GROUPS_CLAIM || 'groups');
  // An older provider's users: the groups they typed as a claim become their memberships.
  users.migrate();
  const provider = new Provider(loadKey(dir), { users, passwordGrant: ['1', 'true'].includes(process.env.OIDC_PASSWORD_GRANT ?? '') });
  const adminToken = process.env.OIDC_ADMIN_TOKEN || undefined;
  const adminDir = process.env.OIDC_ADMIN_DIR && statSync(join(process.env.OIDC_ADMIN_DIR, 'index.html'), { throwIfNoEntry: false }) ? process.env.OIDC_ADMIN_DIR : undefined;
  const adminOpen = ['0', 'false'].includes(process.env.OIDC_ADMIN_LOGIN ?? '');
  const server = createServer(
    handler(provider, { users, ...(adminToken ? { adminToken } : {}), ...(adminOpen ? { adminOpen } : {}), ...(adminDir ? { adminDir } : {}), openLogin: !['0', 'false'].includes(process.env.OIDC_OPEN_LOGIN ?? '') }),
  );
  server.listen(port, () => console.log(`oidc: listening on ${port}; issuers at /<name>`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = start();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
}
