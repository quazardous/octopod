# Signing in with OpenID Connect, locally

An app that signs in with OpenID Connect (Authentik, Keycloak, Google, Entra in production)
gets a provider in development with the `oidc` recipe: octopod's own, with no account to
create elsewhere and no login bypass in the app's code.

```yaml
services:
  app: { recipe: python-app }   # OIDC_ISSUER_BASE=http://id.shop.localhost
  id:  { recipe: oidc }         # issuers at http://id.shop.localhost/<name>
```

## Issuers

Any path is an issuer: `http://id.shop.localhost/staff` and `http://id.shop.localhost/google`
are two, with nothing to declare. The app composes its issuer from `OIDC_ISSUER_BASE` and
keeps its client id in its own configuration, as in production; the provider takes any
client id and any secret. The issuer's URL is the same for the browser and for the app's
container (a project's containers reach its hosts through the edge), so a token's `iss`
matches on both sides.

## Signing in

The login page lists the provider's users (one click, or their password), and, unless the
recipe says `open-login: false`, takes any user name and the claims to sign:
`{"groups": ["staff"], "email": "ada@example.test"}`. Each role is tried by typing it.

## Users and the admin

`http://id.<project>.localhost/admin/` is the provider's admin, a qdadm app: its users, their
claims, a password or none, the issuers they may use. It signs in with the service's admin
token, which `octopod secrets <project>` shows (`admin-token`). The same users are on its
JSON API, `/admin/api/users`, with that token as a bearer token.

## A CI without a browser

With `password-grant: true` on the recipe, a test trades a user's name and password for
tokens:

```sh
TOKEN=… # octopod secrets shop: the id service's admin-token
curl -X PUT -H "Authorization: Bearer $TOKEN" -d '{"claims":{"groups":["staff"]},"password":"ci-pass"}' \
  http://id.shop.localhost/admin/api/users/ci
curl -d 'grant_type=password&client_id=ci&username=ci&password=ci-pass' http://id.shop.localhost/staff/token
```

`client_credentials` is served too, for a service that signs in as itself.

## What it is not

A development provider: it trusts any client and any redirect, and signs whatever claims
it is told. It answers on loopback, behind the edge, like every project; never let a real
service trust it. The provider itself, its endpoints and how it is built:
[src/oidc/README.md](../src/oidc/README.md).
