/**
 * A small OpenID Connect provider: discovery, keys, the authorization code flow with PKCE,
 * tokens and userinfo. No dependency but Node's crypto. HTTP is the server's business
 * (server.ts); this is the protocol, testable without a socket.
 *
 * An issuer is a URL: `http://id.demo.localhost/admi`. The provider serves any number of
 * them with one key; who logs in is decided by the caller of `issueCode` — today a login
 * page that takes a user name and its claims, for development.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';

/** How long a code waits to be exchanged, and how long a token lasts. */
export const CODE_MS = 60_000;
export const TOKEN_S = 3600;

/** Claims the provider sets itself: a login's claims never replace them. */
const RESERVED = ['iss', 'aud', 'exp', 'iat', 'nbf', 'auth_time', 'nonce', 'azp', 'client_id', 'scope'];

export interface AuthRequest {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

export interface Login {
  sub: string;
  claims: Record<string, unknown>;
}

export type Answer = { status: number; body: Record<string, unknown> };

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** A new signing key, as PEM: kept by the server, so tokens outlive a restart. */
export function newKeyPem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function failure(status: number, error: string, description: string): Answer {
  return { status, body: { error, error_description: description } };
}

export class Provider {
  private readonly key: KeyObject;
  private readonly publicKey: KeyObject;
  readonly kid: string;
  private readonly codes = new Map<string, { request: AuthRequest; login: Login; expires: number; authTime: number }>();

  constructor(
    keyPem: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createPrivateKey(keyPem);
    this.publicKey = createPublicKey(this.key);
    const { n, e } = this.publicKey.export({ format: 'jwk' });
    // RFC 7638 thumbprint: a kid that changes with the key, and only with it.
    this.kid = b64url(createHash('sha256').update(JSON.stringify({ e, kty: 'RSA', n })).digest());
  }

  discovery(issuer: string): Record<string, unknown> {
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

  jwks(): Record<string, unknown> {
    return { keys: [{ ...this.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' }] };
  }

  /** The authorization request a client sent, checked; an error a client is told otherwise. */
  authorizeRequest(issuer: string, q: Record<string, string | undefined>): AuthRequest | { error: string } {
    if (q.response_type !== 'code') return { error: 'response_type must be code' };
    if (!q.client_id) return { error: 'client_id is missing' };
    if (!q.redirect_uri || !/^https?:\/\//.test(q.redirect_uri)) return { error: 'redirect_uri must be an http(s) URL' };
    if (!(q.scope ?? '').split(' ').includes('openid')) return { error: 'scope must include openid' };
    const method = q.code_challenge ? (q.code_challenge_method ?? 'plain') : undefined;
    if (method && method !== 'S256' && method !== 'plain') return { error: 'code_challenge_method must be S256 or plain' };
    return {
      issuer,
      clientId: q.client_id,
      redirectUri: q.redirect_uri,
      scope: q.scope!,
      ...(q.state ? { state: q.state } : {}),
      ...(q.nonce ? { nonce: q.nonce } : {}),
      ...(q.code_challenge ? { codeChallenge: q.code_challenge, codeChallengeMethod: method as 'S256' | 'plain' } : {}),
    };
  }

  /** A code for a login, once: where the browser goes back to, with it. */
  issueCode(request: AuthRequest, login: Login): string {
    const code = randomBytes(24).toString('base64url');
    const now = this.now();
    for (const [c, v] of this.codes) if (v.expires <= now) this.codes.delete(c);
    this.codes.set(code, { request, login, expires: now + CODE_MS, authTime: Math.floor(now / 1000) });
    const back = new URL(request.redirectUri);
    back.searchParams.set('code', code);
    if (request.state) back.searchParams.set('state', request.state);
    return back.toString();
  }

  /**
   * The token endpoint, for the authorization code grant. Any client secret is taken: a
   * client is the redirect URI and the code it holds, as a development provider needs.
   */
  token(issuer: string, form: Record<string, string | undefined>, basicClientId?: string): Answer {
    if (form.grant_type !== 'authorization_code') return failure(400, 'unsupported_grant_type', 'only authorization_code');
    const entry = form.code ? this.codes.get(form.code) : undefined;
    if (form.code) this.codes.delete(form.code);
    if (!entry || entry.expires <= this.now() || entry.request.issuer !== issuer) return failure(400, 'invalid_grant', 'unknown, used or expired code');
    const { request, login } = entry;
    const clientId = basicClientId ?? form.client_id;
    if (clientId !== request.clientId) return failure(400, 'invalid_grant', 'the code was issued to another client');
    if (form.redirect_uri !== request.redirectUri) return failure(400, 'invalid_grant', 'redirect_uri differs from the authorization request');
    if (request.codeChallenge) {
      const verifier = form.code_verifier ?? '';
      const derived = request.codeChallengeMethod === 'S256' ? b64url(createHash('sha256').update(verifier).digest()) : verifier;
      if (!verifier || derived !== request.codeChallenge) return failure(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
    }
    const iat = Math.floor(this.now() / 1000);
    const claims = Object.fromEntries(Object.entries(login.claims).filter(([k]) => !RESERVED.includes(k) && k !== 'sub'));
    const common = { iss: issuer, sub: login.sub, iat, exp: iat + TOKEN_S };
    const idToken = this.sign({ preferred_username: login.sub, name: login.sub, ...claims, ...common, aud: request.clientId, auth_time: entry.authTime, ...(request.nonce ? { nonce: request.nonce } : {}) });
    const accessToken = this.sign({ ...claims, ...common, aud: request.clientId, client_id: request.clientId, scope: request.scope });
    return { status: 200, body: { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_S, id_token: idToken, scope: request.scope } };
  }

  /** The claims of the access token a request carries. */
  userinfo(issuer: string, authorization: string | undefined): Answer {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    const payload = token ? this.verify(token) : undefined;
    if (!payload || payload.iss !== issuer) return failure(401, 'invalid_token', 'no valid access token');
    const { iss: _iss, aud: _aud, exp: _exp, iat: _iat, client_id: _client, scope: _scope, ...claims } = payload;
    return { status: 200, body: { preferred_username: payload.sub, name: payload.sub, ...claims } };
  }

  /** A JWT signed with the provider's key (RS256). */
  sign(payload: Record<string, unknown>): string {
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${b64url(sign('sha256', Buffer.from(`${head}.${body}`), this.key))}`;
  }

  /** The payload of a JWT this provider signed and that has not expired; undefined otherwise. */
  verify(token: string): Record<string, unknown> | undefined {
    const [head, body, signature] = token.split('.');
    if (!head || !body || !signature) return undefined;
    if (!verify('sha256', Buffer.from(`${head}.${body}`), this.publicKey, Buffer.from(signature, 'base64url'))) return undefined;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    return typeof payload.exp === 'number' && payload.exp * 1000 > this.now() ? payload : undefined;
  }
}
