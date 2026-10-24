# octopod's OpenID Connect provider

A small OpenID Connect provider, with no dependency but Node's `crypto`. octopod runs it as
the `oidc` recipe, so a project that signs in with OIDC (Authentik, Keycloak, Google,
Entra in production) has a provider in development without installing one, and without a
login bypass in its code.

It is a tool of its own: `provider.ts` is the protocol, `users.ts` the users it keeps,
`server.ts` puts it on HTTP, `admin.ts` is its admin page. Today
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
| `/<issuer>/token` | `authorization_code`; `client_credentials`; `password` when it is on |
| `/<issuer>/userinfo` | the access token's claims |
| `/<issuer>/logout` | back to `post_logout_redirect_uri` |
| `/health` | `{ ok: true }` |
| `/admin/` | the admin: the qdadm app of `oidc-admin/` when `OIDC_ADMIN_DIR` names its build, a built-in page otherwise |
| `/admin/api/users[/<name>]` | `GET` (`{ users, total }`), `POST` (`{ sub, … }`), `PUT` (`{ claims, password?, issuers? }`), `DELETE`, with `Authorization: Bearer <admin token>` |

**Users.** The provider keeps users in `OIDC_DATA/users.json`: a name, its claims, a password
(stored as a scrypt hash, never as given) or none, and the issuers it may sign in to (all
when none are named). The login page lists them: one click for a user without a password,
its password otherwise. `password` grant (`OIDC_PASSWORD_GRANT=1`): a CI's tests trade a
user's name and password for tokens, with no browser; only users with a password.

**Open login** (on unless `OIDC_OPEN_LOGIN=0`): the login page also takes any user name (the `sub`) and the claims to sign, as JSON:
`{"groups": ["admi-dev"], "email": "ada@example.test"}`. Each role is tried by typing it.
Claims the provider sets itself (`iss`, `aud`, `exp`, `nonce`…) cannot be replaced.

**For development only, as it stands:** any client id is taken, any client secret, any
redirect URI. A client is held to what it said at `authorize` (the same client id, the same
redirect URI, its PKCE verifier), and a code is used once, within a minute. Tokens last an hour.

## Running it

```sh
PORT=8080 OIDC_DATA=/data OIDC_ADMIN_TOKEN=… node server.js
```

Without `OIDC_ADMIN_TOKEN` there is no admin: its page and API answer 404.

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
fails while the two differ. The admin app, `oidc-admin/` (qdadm: Vue 3 and PrimeVue, its
direct versions pinned, its lockfile kept), goes in as sources too: a first stage of the image
runs `npm ci` and `vite build`, and only its `dist/` reaches the final image. In development:
`cd oidc-admin && npm install --legacy-peer-deps && OIDC_URL=http://127.0.0.1:8080 npm run dev`.
