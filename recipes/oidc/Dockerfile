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
    now;
    key;
    publicKey;
    kid;
    codes = new Map();
    constructor(keyPem, now = Date.now) {
        this.now = now;
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
            grant_types_supported: ['authorization_code'],
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
        if (form.grant_type !== 'authorization_code')
            return failure(400, 'unsupported_grant_type', 'only authorization_code');
        const entry = form.code ? this.codes.get(form.code) : undefined;
        if (form.code)
            this.codes.delete(form.code);
        if (!entry || entry.expires <= this.now() || entry.request.issuer !== issuer)
            return failure(400, 'invalid_grant', 'unknown, used or expired code');
        const { request, login } = entry;
        const clientId = basicClientId ?? form.client_id;
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
        const iat = Math.floor(this.now() / 1000);
        const claims = Object.fromEntries(Object.entries(login.claims).filter(([k]) => !RESERVED.includes(k) && k !== 'sub'));
        const common = { iss: issuer, sub: login.sub, iat, exp: iat + TOKEN_S };
        const idToken = this.sign({ preferred_username: login.sub, name: login.sub, ...claims, ...common, aud: request.clientId, auth_time: entry.authTime, ...(request.nonce ? { nonce: request.nonce } : {}) });
        const accessToken = this.sign({ ...claims, ...common, aud: request.clientId, client_id: request.clientId, scope: request.scope });
        return { status: 200, body: { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_S, id_token: idToken, scope: request.scope } };
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
 *   PORT        where it listens (8080)
 *   OIDC_DATA   where the signing key is kept (/data); made on first start
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newKeyPem, Provider } from './provider.js';
const ISSUER = /^\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
/** What the login page passes back, beside the user name and claims. */
const REQUEST_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function send(res, status, body, headers = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(text);
}
async function form(req) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000)
            throw new Error('request too large');
    }
    return Object.fromEntries(new URLSearchParams(raw));
}
/** The client id of a `client_secret_basic` Authorization header; the secret is not checked. */
function basicClientId(header) {
    const value = /^Basic\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!value)
        return undefined;
    return decodeURIComponent(Buffer.from(value, 'base64').toString().split(':')[0] ?? '');
}
function loginPage(issuer, query, error = '') {
    const hidden = REQUEST_FIELDS.filter((f) => query[f]).map((f) => `<input type="hidden" name="${f}" value="${escape(query[f])}">`).join('');
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
export function handler(provider) {
    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (url.pathname === '/health')
            return send(res, 200, { ok: true });
        const match = ISSUER.exec(url.pathname);
        if (!match)
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
                return send(res, 200, loginPage(issuer, query));
            }
            if (path === '/authorize' && req.method === 'POST') {
                const fields = await form(req);
                const request = provider.authorizeRequest(issuer, fields);
                if ('error' in request)
                    return send(res, 400, { error: 'invalid_request', error_description: request.error });
                let claims;
                try {
                    claims = JSON.parse(fields.claims || '{}');
                }
                catch {
                    claims = undefined;
                }
                if (!claims || typeof claims !== 'object' || Array.isArray(claims))
                    return send(res, 400, loginPage(issuer, fields, 'The claims must be a JSON object.'));
                const sub = (fields.username ?? '').trim();
                if (!sub)
                    return send(res, 400, loginPage(issuer, fields, 'A user name is needed.'));
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
    const server = createServer(handler(new Provider(loadKey(dir))));
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
