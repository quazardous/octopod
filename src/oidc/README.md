# octopod's OpenID Connect provider

A small OpenID Connect provider, with no dependency but Node's `crypto`. octopod runs it as
the `oidc` recipe, so a project that signs in with OIDC (Authentik, Keycloak, Google,
Entra in production) has a provider in development without installing one, and without a
login bypass in its code.

It is a tool of its own: `provider.ts` is the protocol, `server.ts` puts it on HTTP. Today
it is a development provider; nothing in it stops it from growing into a real one (accounts,
registered clients, consent).

## What it serves

Every first path segment is an issuer: `/admi` and `/google` are two, with nothing to
declare. The issuer's URL is the address the request came to (`Host`, and
`X-Forwarded-Proto` behind a proxy). Behind octopod's edge it is the same from the browser and
from the project's containers, so a token's `iss` matches on both sides.

| Path | |
|---|---|
| `/<issuer>/.well-known/openid-configuration` | discovery |
| `/<issuer>/jwks` | the public key (RS256) |
| `/<issuer>/authorize` | the authorization code flow, PKCE (`S256`, `plain`) optional; GET shows the login page |
| `/<issuer>/token` | `authorization_code` |
| `/<issuer>/userinfo` | the access token's claims |
| `/<issuer>/logout` | back to `post_logout_redirect_uri` |
| `/health` | `{ ok: true }` |

The login page takes a user name (the `sub`) and the claims to sign, as JSON:
`{"groups": ["admi-dev"], "email": "ada@example.test"}`. Each role is tried by typing it.
Claims the provider sets itself (`iss`, `aud`, `exp`, `nonce`…) cannot be replaced.

**For development only, as it stands:** any client id is taken, any client secret, any
redirect URI. A client is held to what it said at `authorize` (the same client id, the same
redirect URI, its PKCE verifier), and a code is used once, within a minute. Tokens last an hour.

## Running it

```sh
PORT=8080 OIDC_DATA=/data node server.js
```

The signing key is made in `OIDC_DATA` on first start (`signing-key.pem`, `0600`) and kept:
tokens, and the keys the apps cached, outlive a restart.

## In octopod

```yaml
services:
  app: { recipe: python-app }   # gets OIDC_ISSUER_BASE=http://id.<project>.localhost
  id:  { recipe: oidc }
```

The recipe's image is built from these sources: `npm run oidc:recipe` writes them, compiled,
into `recipes/oidc/Dockerfile` (a recipe's build context is its Dockerfile alone), and a test
fails while the two differ.
