# syntax=docker/dockerfile:1
# GENERATED from src/oidc by scripts/oidc-dockerfile.mjs: edit those, then run
# `npm run oidc:recipe`. The provider runs as the image's `node` user, renamed after the
# project and moved to the operator's uid/gid; its signing key is kept in /data.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
RUN groupmod -o -g "$GID" -n "$USER_NAME" node \
 && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m node
COPY <<'OIDC_PACKAGE' /opt/oidc/package.json
{ "type": "module" }
OIDC_PACKAGE
COPY <<'OIDC_USERS' /opt/oidc/users.js
/**
 * The provider's users: who may sign in, with which claims, and with which password (kept
 * as a scrypt hash, never as given). Kept in one JSON file of the provider's data, written
 * whole and atomically: a development provider has a handful of users, not a directory.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
const SUB = /^[A-Za-z0-9._@+-]{1,128}$/;
const ISSUER = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function hashPassword(password) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}
export function passwordMatches(hash, password) {
    const [kind, salt, expected] = (hash ?? '').split('$');
    if (kind !== 'scrypt' || !salt || !expected)
        return false;
    const got = scryptSync(password, Buffer.from(salt, 'base64url'), 32);
    const want = Buffer.from(expected, 'base64url');
    return got.length === want.length && timingSafeEqual(got, want);
}
/** A user as the admin API gives it, checked; an error to say otherwise. */
export function userOf(sub, body, previous) {
    if (!SUB.test(sub))
        return { error: 'a user name is 1 to 128 letters, digits and . _ @ + -' };
    const input = (body ?? {});
    if (input.claims !== undefined && (typeof input.claims !== 'object' || input.claims === null || Array.isArray(input.claims)))
        return { error: 'claims must be a JSON object' };
    if (input.password !== undefined && input.password !== null && (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 200)) {
        return { error: 'password must be a string of 1 to 200 characters, or null to remove it' };
    }
    if (input.issuers !== undefined && input.issuers !== null && (!Array.isArray(input.issuers) || !input.issuers.every((i) => typeof i === 'string' && ISSUER.test(i)))) {
        return { error: 'issuers must be a list of issuer names, or null for all of them' };
    }
    const claims = input.claims ?? previous?.claims ?? {};
    const password = input.password === null ? undefined : typeof input.password === 'string' ? hashPassword(input.password) : previous?.password;
    const issuers = input.issuers === null ? undefined : (input.issuers ?? previous?.issuers);
    return { sub, claims, ...(password ? { password } : {}), ...(issuers ? { issuers } : {}) };
}
export const shown = (u) => ({ sub: u.sub, claims: u.claims, password: Boolean(u.password), ...(u.issuers ? { issuers: u.issuers } : {}) });
export class Users {
    file;
    constructor(file) {
        this.file = file;
    }
    all() {
        try {
            return JSON.parse(readFileSync(this.file, 'utf8')).users ?? [];
        }
        catch {
            return [];
        }
    }
    get(sub) {
        return this.all().find((u) => u.sub === sub);
    }
    /** The users who may sign in to an issuer. */
    of(issuer) {
        return this.all().filter((u) => !u.issuers || u.issuers.includes(issuer));
    }
    put(user) {
        this.write([...this.all().filter((u) => u.sub !== user.sub), user].sort((a, b) => a.sub.localeCompare(b.sub)));
    }
    delete(sub) {
        const all = this.all();
        if (!all.some((u) => u.sub === sub))
            return false;
        this.write(all.filter((u) => u.sub !== sub));
        return true;
    }
    write(users) {
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
        renameSync(`${this.file}.tmp`, this.file);
    }
}
OIDC_USERS
COPY <<'OIDC_ADMIN' /opt/oidc/admin.js
/**
 * The admin page (`/admin`): the users of the store, added, changed and removed through the
 * admin API with its token. One page, no dependency; the token is kept in the tab's session
 * storage, never in a cookie, so another site cannot act with it.
 */
export function adminPage() {
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>OIDC users</title>
<style>
body{font:14px system-ui;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#222}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ddd;vertical-align:top}
code{font-size:12px;word-break:break-all}input,textarea{font:inherit;padding:.35rem;box-sizing:border-box}textarea{width:100%;height:6rem;font-family:monospace}
label{display:block;margin:.6rem 0 .2rem}button{font:inherit;padding:.35rem .9rem}.error{color:#b00}.muted{color:#666}
</style>
<h1>Users</h1>
<p class="muted">Who may sign in, with which claims. The admin token is in <code>octopod secrets &lt;project&gt;</code> (the service's <code>admin-token</code>).</p>
<form id="auth"><input id="token" type="password" placeholder="admin token" size="40" aria-label="admin token"> <button>Use</button></form>
<p id="error" class="error" hidden></p>
<table><thead><tr><th>User</th><th>Claims</th><th>Password</th><th>Issuers</th><th></th></tr></thead><tbody id="users"></tbody></table>
<h2 id="title">Add a user</h2>
<form id="edit">
<label for="sub">User name</label><input id="sub" required pattern="[A-Za-z0-9._@+-]{1,128}">
<label for="claims">Claims (JSON)</label><textarea id="claims">{"email": "", "groups": []}</textarea>
<label for="password">Password <span class="muted">(empty: unchanged; none at all: one-click sign-in)</span></label><input id="password" type="password" autocomplete="new-password">
<label><input id="nopassword" type="checkbox"> remove its password</label>
<label for="issuers">Issuers <span class="muted">(comma-separated; empty: all)</span></label><input id="issuers" placeholder="admi, google">
<p><button>Save</button> <button type="button" id="reset">New</button></p>
</form>
<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('oidc-admin') || '';
const fail = (m) => { $('error').textContent = m; $('error').hidden = !m; };
async function api(method, path, payload) {
  const r = await fetch('/admin/api' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || r.statusText);
  return data;
}
function cell(text, code) { const td = document.createElement('td'); const n = document.createElement(code ? 'code' : 'span'); n.textContent = text; td.append(n); return td; }
async function load() {
  if (!token) return;
  try {
    const { users } = await api('GET', '/users');
    fail('');
    $('users').replaceChildren(...users.map((u) => {
      const tr = document.createElement('tr');
      const actions = document.createElement('td');
      const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.onclick = () => fill(u);
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.onclick = async () => { if (del.textContent !== 'Sure?') { del.textContent = 'Sure?'; return; } await api('DELETE', '/users/' + encodeURIComponent(u.sub)).catch((e) => fail(e.message)); load(); };
      actions.append(edit, ' ', del);
      tr.append(cell(u.sub), cell(JSON.stringify(u.claims), true), cell(u.password ? 'yes' : 'none'), cell((u.issuers || ['all']).join(', ')), actions);
      return tr;
    }));
  } catch (e) { fail(e.message); }
}
function fill(u) {
  $('title').textContent = u ? 'Edit ' + u.sub : 'Add a user';
  $('sub').value = u ? u.sub : ''; $('sub').readOnly = Boolean(u);
  $('claims').value = u ? JSON.stringify(u.claims, null, 2) : '{"email": "", "groups": []}';
  $('password').value = ''; $('nopassword').checked = false;
  $('issuers').value = u && u.issuers ? u.issuers.join(', ') : '';
}
$('auth').onsubmit = (e) => { e.preventDefault(); token = $('token').value.trim(); sessionStorage.setItem('oidc-admin', token); load(); };
$('reset').onclick = () => fill(null);
$('edit').onsubmit = async (e) => {
  e.preventDefault();
  let claims;
  try { claims = JSON.parse($('claims').value || '{}'); } catch { return fail('The claims must be JSON.'); }
  const issuers = $('issuers').value.split(',').map((s) => s.trim()).filter(Boolean);
  const payload = { claims, issuers: issuers.length ? issuers : null };
  if ($('nopassword').checked) payload.password = null; else if ($('password').value) payload.password = $('password').value;
  try { await api('PUT', '/users/' + encodeURIComponent($('sub').value), payload); fill(null); fail(''); load(); } catch (err) { fail(err.message); }
};
load();
</script>`;
}
OIDC_ADMIN
COPY <<'OIDC_PROVIDER' /opt/oidc/provider.js
/**
 * A small OpenID Connect provider: discovery, keys, the authorization code flow with PKCE,
 * tokens and userinfo. No dependency but Node's crypto. HTTP is the server's business
 * (server.ts); this is the protocol, testable without a socket.
 *
 * An issuer is a URL: `http://id.demo.localhost/admi`. The provider serves any number of
 * them with one key; who logs in is decided by the caller of `issueCode` — today a login
 * page that takes a user name and its claims, for development.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { passwordMatches } from './users.js';
/** How long a code waits to be exchanged, and how long a token lasts. */
export const CODE_MS = 60_000;
export const TOKEN_S = 3600;
/** Claims the provider sets itself: a login's claims never replace them. */
const RESERVED = ['iss', 'aud', 'exp', 'iat', 'nbf', 'auth_time', 'nonce', 'azp', 'client_id', 'scope'];
const b64url = (data) => Buffer.from(data).toString('base64url');
/** A new signing key, as PEM: kept by the server, so tokens outlive a restart. */
export function newKeyPem() {
    return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
function failure(status, error, description) {
    return { status, body: { error, error_description: description } };
}
export class Provider {
    options;
    key;
    publicKey;
    kid;
    codes = new Map();
    now;
    constructor(keyPem, options = {}) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.key = createPrivateKey(keyPem);
        this.publicKey = createPublicKey(this.key);
        const { n, e } = this.publicKey.export({ format: 'jwk' });
        // RFC 7638 thumbprint: a kid that changes with the key, and only with it.
        this.kid = b64url(createHash('sha256').update(JSON.stringify({ e, kty: 'RSA', n })).digest());
    }
    discovery(issuer) {
        return {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            end_session_endpoint: `${issuer}/logout`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'client_credentials', ...(this.options.passwordGrant ? ['password'] : [])],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            scopes_supported: ['openid', 'profile', 'email', 'groups'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            code_challenge_methods_supported: ['S256', 'plain'],
            claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'name', 'preferred_username', 'email', 'groups'],
        };
    }
    jwks() {
        return { keys: [{ ...this.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' }] };
    }
    /** The authorization request a client sent, checked; an error a client is told otherwise. */
    authorizeRequest(issuer, q) {
        if (q.response_type !== 'code')
            return { error: 'response_type must be code' };
        if (!q.client_id)
            return { error: 'client_id is missing' };
        if (!q.redirect_uri || !/^https?:\/\//.test(q.redirect_uri))
            return { error: 'redirect_uri must be an http(s) URL' };
        if (!(q.scope ?? '').split(' ').includes('openid'))
            return { error: 'scope must include openid' };
        const method = q.code_challenge ? (q.code_challenge_method ?? 'plain') : undefined;
        if (method && method !== 'S256' && method !== 'plain')
            return { error: 'code_challenge_method must be S256 or plain' };
        return {
            issuer,
            clientId: q.client_id,
            redirectUri: q.redirect_uri,
            scope: q.scope,
            ...(q.state ? { state: q.state } : {}),
            ...(q.nonce ? { nonce: q.nonce } : {}),
            ...(q.code_challenge ? { codeChallenge: q.code_challenge, codeChallengeMethod: method } : {}),
        };
    }
    /** A code for a login, once: where the browser goes back to, with it. */
    issueCode(request, login) {
        const code = randomBytes(24).toString('base64url');
        const now = this.now();
        for (const [c, v] of this.codes)
            if (v.expires <= now)
                this.codes.delete(c);
        this.codes.set(code, { request, login, expires: now + CODE_MS, authTime: Math.floor(now / 1000) });
        const back = new URL(request.redirectUri);
        back.searchParams.set('code', code);
        if (request.state)
            back.searchParams.set('state', request.state);
        return back.toString();
    }
    /**
     * The token endpoint, for the authorization code grant. Any client secret is taken: a
     * client is the redirect URI and the code it holds, as a development provider needs.
     */
    token(issuer, form, basicClientId) {
        const clientId = basicClientId ?? form.client_id;
        if (form.grant_type === 'client_credentials') {
            // A service for itself: an access token whose subject is the client.
            if (!clientId)
                return failure(400, 'invalid_client', 'client_id is missing');
            const iat = Math.floor(this.now() / 1000);
            const scope = form.scope ?? '';
            return { status: 200, body: { access_token: this.sign({ iss: issuer, sub: clientId, aud: clientId, client_id: clientId, scope, iat, exp: iat + TOKEN_S }), token_type: 'Bearer', expires_in: TOKEN_S, scope } };
        }
        if (form.grant_type === 'password') {
            if (!this.options.passwordGrant)
                return failure(400, 'unsupported_grant_type', 'the password grant is off (OIDC_PASSWORD_GRANT=1 turns it on)');
            if (!clientId)
                return failure(400, 'invalid_client', 'client_id is missing');
            const issuerName = new URL(issuer).pathname.slice(1);
            const user = this.options.users?.of(issuerName).find((u) => u.sub === form.username);
            // A user without a password signs in on the page only: the grant needs one.
            if (!user?.password || !passwordMatches(user.password, form.password ?? ''))
                return failure(400, 'invalid_grant', 'wrong user name or password');
            const scope = form.scope ?? 'openid';
            return { status: 200, body: this.tokens(issuer, clientId, { sub: user.sub, claims: user.claims }, scope, Math.floor(this.now() / 1000)) };
        }
        if (form.grant_type !== 'authorization_code')
            return failure(400, 'unsupported_grant_type', 'authorization_code, client_credentials, or password when it is on');
        const entry = form.code ? this.codes.get(form.code) : undefined;
        if (form.code)
            this.codes.delete(form.code);
        if (!entry || entry.expires <= this.now() || entry.request.issuer !== issuer)
            return failure(400, 'invalid_grant', 'unknown, used or expired code');
        const { request, login } = entry;
        if (clientId !== request.clientId)
            return failure(400, 'invalid_grant', 'the code was issued to another client');
        if (form.redirect_uri !== request.redirectUri)
            return failure(400, 'invalid_grant', 'redirect_uri differs from the authorization request');
        if (request.codeChallenge) {
            const verifier = form.code_verifier ?? '';
            const derived = request.codeChallengeMethod === 'S256' ? b64url(createHash('sha256').update(verifier).digest()) : verifier;
            if (!verifier || derived !== request.codeChallenge)
                return failure(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
        }
        return { status: 200, body: this.tokens(issuer, request.clientId, login, request.scope, entry.authTime, request.nonce) };
    }
    /** An ID token and an access token for a login: the claims it carries, never over the provider's own. */
    tokens(issuer, clientId, login, scope, authTime, nonce) {
        const iat = Math.floor(this.now() / 1000);
        const claims = Object.fromEntries(Object.entries(login.claims).filter(([k]) => !RESERVED.includes(k) && k !== 'sub'));
        const common = { iss: issuer, sub: login.sub, iat, exp: iat + TOKEN_S };
        const idToken = this.sign({ preferred_username: login.sub, name: login.sub, ...claims, ...common, aud: clientId, auth_time: authTime, ...(nonce ? { nonce } : {}) });
        const accessToken = this.sign({ ...claims, ...common, aud: clientId, client_id: clientId, scope });
        return { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_S, id_token: idToken, scope };
    }
    /** The claims of the access token a request carries. */
    userinfo(issuer, authorization) {
        const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
        const payload = token ? this.verify(token) : undefined;
        if (!payload || payload.iss !== issuer)
            return failure(401, 'invalid_token', 'no valid access token');
        const { iss: _iss, aud: _aud, exp: _exp, iat: _iat, client_id: _client, scope: _scope, ...claims } = payload;
        return { status: 200, body: { preferred_username: payload.sub, name: payload.sub, ...claims } };
    }
    /** A JWT signed with the provider's key (RS256). */
    sign(payload) {
        const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid }));
        const body = b64url(JSON.stringify(payload));
        return `${head}.${body}.${b64url(sign('sha256', Buffer.from(`${head}.${body}`), this.key))}`;
    }
    /** The payload of a JWT this provider signed and that has not expired; undefined otherwise. */
    verify(token) {
        const [head, body, signature] = token.split('.');
        if (!head || !body || !signature)
            return undefined;
        if (!verify('sha256', Buffer.from(`${head}.${body}`), this.publicKey, Buffer.from(signature, 'base64url')))
            return undefined;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        return typeof payload.exp === 'number' && payload.exp * 1000 > this.now() ? payload : undefined;
    }
}
OIDC_PROVIDER
COPY <<'OIDC_SERVER' /opt/oidc/server.js
/**
 * The provider over HTTP. Every first path segment is an issuer: `/admi/...` and
 * `/google/...` are two, with nothing to declare. The issuer's URL is the address the
 * request came to (its Host, behind the edge), so it is the same for a browser on the host
 * and for a container of the project that reaches the same host.
 *
 *   PORT                 where it listens (8080)
 *   OIDC_DATA            where the signing key and the users are kept (/data); made on first start
 *   OIDC_ADMIN_TOKEN     the bearer token of the admin API and page (/admin); none: no admin
 *   OIDC_OPEN_LOGIN      0 to sign in only as a user of the store; any user, any claims otherwise
 *   OIDC_PASSWORD_GRANT  1 to trade a user's name and password for tokens, with no browser
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newKeyPem, Provider } from './provider.js';
import { adminPage } from './admin.js';
import { passwordMatches, shown, userOf, Users } from './users.js';
const ISSUER = /^\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
/** First segments that are the provider's own, not issuers. */
const RESERVED = ['admin', 'health'];
/** What the login page passes back, beside the user name and claims. */
const REQUEST_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function send(res, status, body, headers = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(text);
}
async function body(req) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000)
            throw new Error('request too large');
    }
    return raw;
}
async function form(req) {
    return Object.fromEntries(new URLSearchParams(await body(req)));
}
/** The client id of a `client_secret_basic` Authorization header; the secret is not checked. */
function basicClientId(header) {
    const value = /^Basic\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!value)
        return undefined;
    return decodeURIComponent(Buffer.from(value, 'base64').toString().split(':')[0] ?? '');
}
function loginPage(issuer, query, users, open, error = '') {
    const hidden = REQUEST_FIELDS.filter((f) => query[f]).map((f) => `<input type="hidden" name="${f}" value="${escape(query[f])}">`).join('');
    // The store's users: one click for a user without a password, its password otherwise.
    const known = users.length
        ? `<h2>Users</h2>${users
            .map((u) => u.password
            ? `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><b>${escape(u.sub)}</b> <input type="password" name="password" placeholder="password" aria-label="${escape(u.sub)}'s password" required> <button>Sign in</button></form>`
            : `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><button>Sign in as ${escape(u.sub)}</button> <small>${escape(JSON.stringify(u.claims))}</small></form>`)
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
/** Whether a request carries the admin's token: compared in constant time. */
function admitted(header, token) {
    const given = Buffer.from(/^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? '');
    const want = Buffer.from(token);
    return given.length === want.length && timingSafeEqual(given, want);
}
/** The admin API: the users, read and written with the admin's token. */
async function admin(req, res, path, options) {
    if (!options.adminToken)
        return send(res, 404, { error: 'not_found', error_description: 'no admin: OIDC_ADMIN_TOKEN is not set' });
    if (path === '/admin' && req.method === 'GET')
        return send(res, 200, adminPage(), { 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
    if (!admitted(req.headers.authorization, options.adminToken))
        return send(res, 401, { error: 'unauthorized', error_description: 'the admin token is needed (Authorization: Bearer …)' }, { 'www-authenticate': 'Bearer' });
    if (path === '/admin/api/users' && req.method === 'GET')
        return send(res, 200, { users: options.users.all().map(shown) });
    const one = /^\/admin\/api\/users\/([^/]+)$/.exec(path);
    if (!one)
        return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path}` });
    const sub = decodeURIComponent(one[1]);
    const user = options.users.get(sub);
    if (req.method === 'GET')
        return user ? send(res, 200, shown(user)) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
    if (req.method === 'DELETE')
        return options.users.delete(sub) ? send(res, 200, { deleted: sub }) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
    if (req.method === 'PUT') {
        let input;
        try {
            input = JSON.parse((await body(req)) || '{}');
        }
        catch {
            return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
        }
        const next = userOf(sub, input, user);
        if ('error' in next)
            return send(res, 400, { error: 'invalid_request', error_description: next.error });
        options.users.put(next);
        return send(res, user ? 200 : 201, shown(next));
    }
    return send(res, 405, { error: 'method_not_allowed', error_description: `${req.method} on a user: GET, PUT or DELETE` });
}
export function handler(provider, options) {
    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (url.pathname === '/health')
            return send(res, 200, { ok: true });
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            return admin(req, res, url.pathname, options).catch((e) => send(res, 400, { error: 'invalid_request', error_description: e.message }));
        }
        const match = ISSUER.exec(url.pathname);
        if (!match || RESERVED.includes(match[1]))
            return send(res, 404, { error: 'not_found', error_description: 'an issuer is a path: /<name>/.well-known/openid-configuration' });
        const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
        const issuer = `${proto}://${req.headers.host}/${match[1]}`;
        const path = match[2] ?? '';
        const query = Object.fromEntries(url.searchParams);
        try {
            if (path === '/.well-known/openid-configuration' && req.method === 'GET')
                return send(res, 200, provider.discovery(issuer));
            if (path === '/jwks' && req.method === 'GET')
                return send(res, 200, provider.jwks());
            if (path === '/authorize' && req.method === 'GET') {
                const request = provider.authorizeRequest(issuer, query);
                if ('error' in request)
                    return send(res, 400, { error: 'invalid_request', error_description: request.error });
                return send(res, 200, loginPage(issuer, query, options.users.of(match[1]), options.openLogin));
            }
            if (path === '/authorize' && req.method === 'POST') {
                const fields = await form(req);
                const request = provider.authorizeRequest(issuer, fields);
                if ('error' in request)
                    return send(res, 400, { error: 'invalid_request', error_description: request.error });
                const users = options.users.of(match[1]);
                const page = (error) => send(res, 400, loginPage(issuer, fields, users, options.openLogin, error));
                if (fields.as !== undefined) {
                    // A user of the store: its claims, and its password when it has one.
                    const user = users.find((u) => u.sub === fields.as);
                    if (!user || (user.password && !passwordMatches(user.password, fields.password ?? '')))
                        return page('Wrong user or password.');
                    return send(res, 302, '', { location: provider.issueCode(request, { sub: user.sub, claims: user.claims }) });
                }
                if (!options.openLogin)
                    return page('Sign in as one of the users.');
                let claims;
                try {
                    claims = JSON.parse(fields.claims || '{}');
                }
                catch {
                    claims = undefined;
                }
                if (!claims || typeof claims !== 'object' || Array.isArray(claims))
                    return page('The claims must be a JSON object.');
                const sub = (fields.username ?? '').trim();
                if (!sub)
                    return page('A user name is needed.');
                return send(res, 302, '', { location: provider.issueCode(request, { sub, claims: claims }) });
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
                if (back && /^https?:\/\//.test(back))
                    return send(res, 302, '', { location: back });
                return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Signed out</title><p>Signed out.</p>');
            }
            return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path || '/'} on an issuer` });
        }
        catch (e) {
            return send(res, 400, { error: 'invalid_request', error_description: e.message });
        }
    };
}
/** The provider's key, from the data folder; made there, readable by its owner alone, the first time. */
export function loadKey(dir) {
    const file = join(dir, 'signing-key.pem');
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        mkdirSync(dir, { recursive: true });
        const pem = newKeyPem();
        writeFileSync(file, pem, { mode: 0o600 });
        return pem;
    }
}
export function start(port = Number(process.env.PORT ?? 8080), dir = process.env.OIDC_DATA ?? '/data') {
    const users = new Users(join(dir, 'users.json'));
    const provider = new Provider(loadKey(dir), { users, passwordGrant: ['1', 'true'].includes(process.env.OIDC_PASSWORD_GRANT ?? '') });
    const adminToken = process.env.OIDC_ADMIN_TOKEN || undefined;
    const server = createServer(handler(provider, { users, ...(adminToken ? { adminToken } : {}), openLogin: !['0', 'false'].includes(process.env.OIDC_OPEN_LOGIN ?? '') }));
    server.listen(port, () => console.log(`oidc: listening on ${port}; issuers at /<name>`));
    return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = start();
    for (const signal of ['SIGTERM', 'SIGINT'])
        process.on(signal, () => server.close(() => process.exit(0)));
}
OIDC_SERVER
ENV OIDC_DATA=/data PORT=8080
USER ${USER_NAME}
CMD ["node", "/opt/oidc/server.js"]
