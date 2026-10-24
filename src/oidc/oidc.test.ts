import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { get, type Server } from 'node:http';
import { CODE_MS, newKeyPem, Provider } from './provider.js';
import { loadKey, start } from './server.js';

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
    const provider = new Provider(pem, () => clock);
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
    server = start(0, dir);
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
});
