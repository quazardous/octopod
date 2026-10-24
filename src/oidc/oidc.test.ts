import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { get, type Server } from 'node:http';
import { CODE_MS, newKeyPem, Provider } from './provider.js';
import { loadKey, start } from './server.js';
import { Users } from './users.js';

const pem = newKeyPem();
const b64url = (s: Buffer | string) => Buffer.from(s).toString('base64url');
const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

describe('the OIDC provider', () => {
  const issuer = 'http://id.demo.localhost/admi';
  const request = { response_type: 'code', client_id: 'app', redirect_uri: 'http://demo.localhost/callback', scope: 'openid profile', state: 's1', nonce: 'n1' };

  it('describes an issuer, and signs with the key it publishes', () => {
    const provider = new Provider(pem);
    expect(provider.discovery(issuer)).toEqual(expect.objectContaining({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, code_challenge_methods_supported: ['S256', 'plain'] }));
    const jwk = (provider.jwks().keys as Record<string, string>[])[0]!;
    expect(jwk).toEqual(expect.objectContaining({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: provider.kid }));
    const [head, body, sig] = provider.sign({ a: 1 }).split('.');
    expect(verify('sha256', Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig!, 'base64url'))).toBe(true);
  });

  it('exchanges a code once, for the client and redirect it was issued to, with the login\'s claims', () => {
    const provider = new Provider(pem);
    const auth = provider.authorizeRequest(issuer, request);
    if ('error' in auth) throw new Error(auth.error);
    const back = new URL(provider.issueCode(auth, { sub: 'ada', claims: { groups: ['admi-dev'], iss: 'forged', email: 'ada@example.test' } }));
    expect(back.origin + back.pathname).toBe('http://demo.localhost/callback');
    expect(back.searchParams.get('state')).toBe('s1');
    const code = back.searchParams.get('code')!;
    expect(provider.token(issuer, { grant_type: 'authorization_code', code, redirect_uri: request.redirect_uri, client_id: 'other' }).body.error).toBe('invalid_grant');
    // A refused attempt used the code up: a code is tried once.
    expect(provider.token(issuer, { grant_type: 'authorization_code', code, redirect_uri: request.redirect_uri, client_id: 'app' }).body.error).toBe('invalid_grant');

    const again = new URL(provider.issueCode(auth, { sub: 'ada', claims: { groups: ['admi-dev'], iss: 'forged' } })).searchParams.get('code')!;
    const answer = provider.token(issuer, { grant_type: 'authorization_code', code: again, redirect_uri: request.redirect_uri }, 'app');
    expect(answer.status).toBe(200);
    const id = claimsOf(answer.body.id_token as string);
    expect(id).toEqual(expect.objectContaining({ iss: issuer, sub: 'ada', aud: 'app', nonce: 'n1', groups: ['admi-dev'], preferred_username: 'ada' }));
    const info = provider.userinfo(issuer, `Bearer ${answer.body.access_token as string}`);
    expect(info.body).toEqual(expect.objectContaining({ sub: 'ada', groups: ['admi-dev'] }));
    expect(provider.userinfo('http://id.demo.localhost/google', `Bearer ${answer.body.access_token as string}`).status).toBe(401);
  });

  it('holds a PKCE client to its verifier, and lets a code and a token expire', () => {
    let clock = 1_000_000_000_000;
    const provider = new Provider(pem, { now: () => clock });
    const verifier = 'v'.repeat(50);
    const auth = provider.authorizeRequest(issuer, { ...request, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
    if ('error' in auth) throw new Error(auth.error);
    const code = () => new URL(provider.issueCode(auth, { sub: 'ada', claims: {} })).searchParams.get('code')!;
    const exchange = (c: string, v?: string) => provider.token(issuer, { grant_type: 'authorization_code', code: c, redirect_uri: request.redirect_uri, client_id: 'app', ...(v ? { code_verifier: v } : {}) });
    expect(exchange(code(), 'wrong').body.error).toBe('invalid_grant');
    expect(exchange(code()).body.error).toBe('invalid_grant');
    const late = code();
    clock += CODE_MS + 1;
    expect(exchange(late, verifier).body.error).toBe('invalid_grant');
    const answer = exchange(code(), verifier);
    expect(answer.status).toBe(200);
    clock += 3600_000 + 1;
    expect(provider.userinfo(issuer, `Bearer ${answer.body.access_token as string}`).status).toBe(401);
  });

  it('refuses a request it cannot serve, saying why', () => {
    const provider = new Provider(pem);
    expect(provider.authorizeRequest(issuer, { ...request, response_type: 'token' })).toEqual({ error: 'response_type must be code' });
    expect(provider.authorizeRequest(issuer, { ...request, scope: 'profile' })).toEqual({ error: 'scope must include openid' });
    expect(provider.authorizeRequest(issuer, { ...request, redirect_uri: 'javascript:alert(1)' })).toEqual({ error: 'redirect_uri must be an http(s) URL' });
  });
});

describe('the OIDC server', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-oidc-'));
    process.env.OIDC_ADMIN_TOKEN = 'admin-t0ken';
    process.env.OIDC_PASSWORD_GRANT = 'true';
    server = start(0, dir);
    delete process.env.OIDC_ADMIN_TOKEN;
    delete process.env.OIDC_PASSWORD_GRANT;
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps its key, readable by its owner alone', async () => {
    expect(loadKey(dir)).toBe(loadKey(dir));
    if (process.platform !== 'win32') expect((await stat(join(dir, 'signing-key.pem'))).mode & 0o777).toBe(0o600);
  });

  it('serves the code flow at any issuer path, the issuer named after the host asked', async () => {
    // fetch sets its own Host; behind the edge, the Host is the project's.
    const discovery = await new Promise<Record<string, string>>((resolve, reject) =>
      get(`${base}/admi/.well-known/openid-configuration`, { headers: { host: 'id.demo.localhost:8480' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c)).on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject),
    );
    expect(discovery.issuer).toBe('http://id.demo.localhost:8480/admi');
    const verifier = 'x'.repeat(43);
    const query = new URLSearchParams({ response_type: 'code', client_id: 'app', redirect_uri: 'http://demo.localhost/cb', scope: 'openid', state: 'st', code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
    const page = await fetch(`${base}/admi/authorize?${query}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="claims"');
    const login = await fetch(`${base}/admi/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...Object.fromEntries(query), username: 'grace', claims: '{"groups":["admi-admin"]}' }) });
    expect(login.status).toBe(302);
    const back = new URL(login.headers.get('location')!);
    expect(back.searchParams.get('state')).toBe('st');
    const token = await fetch(`${base}/admi/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from('app:anything').toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: 'http://demo.localhost/cb', code_verifier: verifier }),
    });
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as Record<string, string>;
    expect(claimsOf(tokens.id_token!)).toEqual(expect.objectContaining({ sub: 'grace', groups: ['admi-admin'], aud: 'app' }));
    const info = await fetch(`${base}/admi/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(await info.json()).toEqual(expect.objectContaining({ sub: 'grace', groups: ['admi-admin'] }));
  });

  it('says what went wrong: bad claims, a path that is no issuer', async () => {
    const query = { response_type: 'code', client_id: 'app', redirect_uri: 'http://demo.localhost/cb', scope: 'openid' };
    const bad = await fetch(`${base}/admi/authorize`, { method: 'POST', body: new URLSearchParams({ ...query, username: 'x', claims: '[1]' }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('must be a JSON object');
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  const admin = (method: string, path: string, payload?: unknown, token = 'admin-t0ken') =>
    fetch(`${base}/admin/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });

  it('keeps users through its admin API, behind its token, never showing a password', async () => {
    expect((await admin('GET', '/users', undefined, 'wrong')).status).toBe(401);
    expect(await (await fetch(`${base}/admin/api/session`)).json()).toEqual({ open: false });
    expect((await admin('PUT', '/users/ada', { claims: { groups: ['admi-dev'] }, password: 'pa55' })).status).toBe(201);
    expect((await admin('PUT', '/users/bob', { claims: { groups: ['admi-viewer'] }, issuers: ['google'] })).status).toBe(201);
    expect((await admin('PUT', '/users/bad name', {})).status).toBe(400);
    const { users } = (await (await admin('GET', '/users')).json()) as { users: Record<string, unknown>[] };
    expect(users).toEqual([
      { sub: 'ada', claims: { groups: ['admi-dev'] }, groups: [], password: true },
      { sub: 'bob', claims: { groups: ['admi-viewer'] }, groups: [], password: false, issuers: ['google'] },
    ]);
    expect(await readFile(join(dir, 'users.json'), 'utf8')).not.toContain('pa55');
    expect((await fetch(`${base}/admin`)).status).toBe(200);
  });

  it('trades a user\'s password for tokens, with no browser, and refuses a wrong one', async () => {
    const grant = (password: string) =>
      fetch(`${base}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'ci', username: 'ada', password }) });
    expect((await grant('nope')).status).toBe(400);
    const ok = await grant('pa55');
    expect(ok.status).toBe(200);
    expect(claimsOf(((await ok.json()) as Record<string, string>).id_token!)).toEqual(expect.objectContaining({ sub: 'ada', groups: ['admi-dev'], aud: 'ci' }));
    // bob is google's alone, and has no password: neither signs him in here.
    expect((await fetch(`${base}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'ci', username: 'bob', password: '' }) })).status).toBe(400);
  });

  it('signs a user of the store in from the login page, with its claims', async () => {
    const query = { response_type: 'code', client_id: 'app', redirect_uri: 'http://demo.localhost/cb', scope: 'openid' };
    const page = await (await fetch(`${base}/admi/authorize?${new URLSearchParams(query)}`)).text();
    expect(page).toContain('ada');
    expect(page).not.toContain('Sign in as bob');
    const wrong = await fetch(`${base}/admi/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...query, as: 'ada', password: 'x' }) });
    expect(wrong.status).toBe(400);
    const login = await fetch(`${base}/admi/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...query, as: 'ada', password: 'pa55' }) });
    const code = new URL(login.headers.get('location')!).searchParams.get('code')!;
    const tokens = (await (await fetch(`${base}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'app', redirect_uri: query.redirect_uri }) })).json()) as Record<string, string>;
    expect(claimsOf(tokens.id_token!)).toEqual(expect.objectContaining({ sub: 'ada', groups: ['admi-dev'] }));
    // What a list's "create" sends: the name in the body.
    expect((await admin('POST', '/users', { sub: 'carol', claims: { groups: [] } })).status).toBe(201);
    expect((await admin('POST', '/users', { sub: 'carol' })).status).toBe(409);
    expect(((await (await admin('GET', '/users')).json()) as { total: number }).total).toBe(3);
    expect((await admin('DELETE', '/users/bob')).status).toBe(200);
    expect((await admin('GET', '/users/bob')).status).toBe(404);
  });

  it('keeps groups: their claims go to their members, their names in the groups claim, a user\'s own attributes win', async () => {
    expect((await admin('PUT', '/groups/staff', { description: 'the team', claims: { roles: ['admin'], email: 'team@example.test' } })).status).toBe(201);
    expect((await admin('PUT', '/users/dan', { claims: { email: 'dan@example.test' }, groups: ['staff', 'beta'], password: 'd4n' })).status).toBe(201);
    // A group typed on a user exists from then on.
    const { groups } = (await (await admin('GET', '/groups')).json()) as { groups: { name: string; members: string[] }[] };
    expect(groups.map((g) => [g.name, g.members])).toEqual(expect.arrayContaining([['beta', ['dan']], ['staff', ['dan']]]));
    const ok = await fetch(`${base}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'ci', username: 'dan', password: 'd4n' }) });
    expect(claimsOf(((await ok.json()) as Record<string, string>).id_token!)).toEqual(expect.objectContaining({ groups: ['staff', 'beta'], roles: ['admin'], email: 'dan@example.test' }));
    // Members set from the group's side; a group away leaves its members' groups.
    expect((await admin('PUT', '/groups/beta', { members: ['ada'] })).status).toBe(200);
    expect(((await (await admin('GET', '/users/dan')).json()) as { groups: string[] }).groups).toEqual(['staff']);
    expect((await admin('DELETE', '/groups/staff')).status).toBe(200);
    expect(((await (await admin('GET', '/users/dan')).json()) as { groups: string[] }).groups).toEqual([]);
    expect((await admin('PUT', '/groups/bad%2Fname', {})).status).toBe(400);
  });
});

describe('sign-ins on demand (octopod oidc session, link, token)', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-oidc-signin-'));
    process.env.OIDC_ADMIN_TOKEN = 'admin-t0ken';
    process.env.OIDC_ADMIN_LOGIN = 'false';
    server = start(0, dir);
    delete process.env.OIDC_ADMIN_TOKEN;
    delete process.env.OIDC_ADMIN_LOGIN;
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  const asked = (path: string, payload: unknown, token: string | null = 'admin-t0ken') =>
    fetch(`${base}/admin/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
  const query = { response_type: 'code', client_id: 'app', redirect_uri: 'http://demo.octopod.localhost/cb', scope: 'openid', state: 's1' };

  it('signs a user in at once with a ticket, its password unknown, once', async () => {
    await fetch(`${base}/admin/api/users/ada`, { method: 'PUT', body: JSON.stringify({ claims: { email: 'ada@example.test' }, groups: ['staff'], password: 'secret' }) });
    // The admin token, even with the admin open: a container of the project has no business here.
    expect((await asked('sign-in', { sub: 'ada' }, null)).status).toBe(401);
    const { ticket } = (await (await asked('sign-in', { sub: 'ada' })).json()) as { ticket: string };
    const authorize = (t: string) => fetch(`${base}/admi/authorize?${new URLSearchParams({ ...query, login_ticket: t })}`, { redirect: 'manual' });
    const first = await authorize(ticket);
    expect(first.status).toBe(302);
    const back = new URL(first.headers.get('location')!);
    expect(back.searchParams.get('state')).toBe('s1');
    const tokens = (await (await fetch(`${base}/admi/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, client_id: 'app', redirect_uri: query.redirect_uri }) })).json()) as Record<string, string>;
    expect(claimsOf(tokens.id_token!)).toEqual(expect.objectContaining({ sub: 'ada', email: 'ada@example.test', groups: ['staff'] }));
    // Used up: the page, as for anyone.
    expect((await authorize(ticket)).status).toBe(200);
  });

  it('signs in a passing identity, from a link through a cookie of its own', async () => {
    const { ticket } = (await (await asked('sign-in', { claims: { groups: ['beta'] } })).json()) as { ticket: string };
    const link = await fetch(`${base}/sign-in?${new URLSearchParams({ ticket, next: 'http://demo.octopod.localhost/login' })}`, { redirect: 'manual' });
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toBe('http://demo.octopod.localhost/login');
    const cookie = link.headers.get('set-cookie')!.split(';')[0]!;
    const back = await fetch(`${base}/admi/authorize?${new URLSearchParams(query)}`, { redirect: 'manual', headers: { cookie } });
    expect(back.status).toBe(302);
    expect(back.headers.get('set-cookie')).toMatch(/oidc_ticket=; .*Max-Age=0/);
    expect((await fetch(`${base}/sign-in?${new URLSearchParams({ ticket, next: 'http://x' })}`, { redirect: 'manual' })).status).toBe(400);
  });

  it('gives tokens with no flow, without the password grant', async () => {
    expect((await asked('tokens', { sub: 'ada' }, null)).status).toBe(401);
    const tokens = (await (await asked('tokens', { sub: 'ada', issuer: 'admi', client_id: 'api' })).json()) as Record<string, string>;
    expect(claimsOf(tokens.access_token!)).toEqual(expect.objectContaining({ sub: 'ada', aud: 'api', groups: ['staff'] }));
    expect(claimsOf(tokens.id_token!).iss).toMatch(/\/admi$/);
    expect((await asked('tokens', { sub: 'nobody' })).status).toBe(400);
  });
});

describe('the OIDC users of an older provider', () => {
  it('turns the groups a user typed as a claim into its memberships, the groups made', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'octopod-oidc-old-'));
    const file = join(dir, 'users.json');
    await writeFile(file, JSON.stringify({ users: [{ sub: 'ada', claims: { groups: ['dev'], email: 'ada@example.test' } }] }));
    const users = new Users(file, 'roles');
    users.migrate();
    expect(users.get('ada')).toEqual({ sub: 'ada', claims: { email: 'ada@example.test' }, groups: ['dev'] });
    expect(users.groups()).toEqual([{ name: 'dev' }]);
    // Signed in the claim the provider was told: an app that reads roles.
    expect(users.claimsOf(users.get('ada')!)).toEqual({ email: 'ada@example.test', roles: ['dev'] });
    await rm(dir, { recursive: true, force: true });
  });
});

describe('the OIDC server with an open admin (the recipe\'s default)', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-oidc-open-'));
    process.env.OIDC_ADMIN_TOKEN = 'admin-t0ken';
    process.env.OIDC_ADMIN_LOGIN = 'false';
    server = start(0, dir);
    delete process.env.OIDC_ADMIN_TOKEN;
    delete process.env.OIDC_ADMIN_LOGIN;
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it('says it is open, and keeps users with no token, a token still taken', async () => {
    expect(await (await fetch(`${base}/admin/api/session`)).json()).toEqual({ open: true, token: 'admin-t0ken' });
    expect((await fetch(`${base}/admin/api/users/ada`, { method: 'PUT', body: JSON.stringify({ claims: { groups: ['staff'] } }) })).status).toBe(201);
    expect((await fetch(`${base}/admin/api/users`, { headers: { authorization: 'Bearer admin-t0ken' } })).status).toBe(200);
    const { users } = (await (await fetch(`${base}/admin/api/users`)).json()) as { users: { sub: string }[] };
    expect(users.map((u) => u.sub)).toEqual(['ada']);
  });
});
