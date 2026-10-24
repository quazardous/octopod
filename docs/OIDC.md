# Signing in with OpenID Connect, locally

An app that signs in with OpenID Connect (Authentik, Keycloak, Google, Entra in production)
gets a provider in development with the `oidc` recipe: octopod's own, with no account to
create elsewhere and no login bypass in the app's code.

```yaml
services:
  app: { recipe: python-app }   # OIDC_ISSUER_BASE=http://id.shop.octopod.localhost
  id:  { recipe: oidc }         # issuers at http://id.shop.octopod.localhost/<name>
```

In production the app signs in with the real provider instead, **with the same code**: only
three settings change. [In production: the real provider](#in-production-the-real-provider)
says which, provider by provider.

## Issuers

Any path is an issuer: `http://id.shop.octopod.localhost/staff` and `http://id.shop.octopod.localhost/google`
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

`http://id.<project>.octopod.localhost/admin/` is the provider's admin, a qdadm app: its users
(their groups, their attributes — `email`, `name`… and any other —, a password or none, the
issuers they may use) and its groups (what each is for, its members, the claims it gives
them, `roles: [admin]`). A user signs its groups' claims, then its own attributes (they
win), then the names of its groups in `groups` — `groups-claim: roles` on the service for an
app that reads another claim. The login page shows each user with its groups. It opens straight on them: a
development provider behind the edge, which answers your machine and the project alone.
The same users are on its JSON API, `/admin/api/users`, which asks for nothing either.
`admin-login: true` on the service makes both ask for the service's admin token
(`octopod secrets <project>`, `admin-token`), as a password or a bearer token.

From the command line, for a person or an agent, the project's provider — its own, or its
group's:

```sh
octopod oidc users                         # the users, their groups and attributes
octopod oidc user ada --group staff --attr email=ada@example.test --password p4ss   # made or changed
octopod oidc groups                        # the groups, their members
octopod oidc group add staff --claims '{"roles":["admin"]}'   # or remove
octopod oidc user ada --no-password        # one-click sign-in again; --issuers a,b limits it
octopod oidc remove ada
```

## Signed in, with no password: agents, tests, a browser

An agent or a test signs an app in as one of the provider's users — its groups and
attributes, its password never asked — or as a passing identity (`--claims`):

```sh
octopod oidc session ada --url http://shop.octopod.localhost/oidc/authenticate/
# Cookie: sessionid=…        (--json: each cookie; --cookie-jar f.txt: curl's file, Playwright reads it)
octopod oidc link ada --url http://shop.octopod.localhost/oidc/authenticate/
# http://id.shop.octopod.localhost/sign-in?ticket=…   open it: the app comes back signed in, once, within 2 minutes
octopod oidc token ada --issuer staff --client api      # signed id and access tokens, for an API's bearer
octopod oidc session --claims '{"groups":["beta"]}' --url …   # nobody in the provider: these claims
```

`--url` is the address that starts the app's own sign-in: `session` follows it through the
edge as a browser would, the provider letting the user in at once with a single-use ticket,
and keeps the cookies the app sets — any OIDC app, nothing in its code. The tickets and the
tokens are asked for with the admin token, even when the admin is open, and the provider
logs each one. An agent with `octopod mcp` has the same as `octopod_oidc_session` (`link:
true` for the link) and `octopod_oidc_token`.

## A CI without a browser

With `password-grant: true` on the recipe, a test trades a user's name and password for
tokens:

```sh
octopod oidc user shop ci --group staff --password ci-pass   # or a PUT on /admin/api/users/ci
curl -d 'grant_type=password&client_id=ci&username=ci&password=ci-pass' http://id.shop.octopod.localhost/staff/token
```

`client_credentials` is served too, for a service that signs in as itself.

## In production: the real provider

The development provider stands in for the real one; it never goes to production. An app
built for it switches with **no code change**, if it keeps to three rules from the start.

**1. Everything the app knows of its provider is three settings.**

| Setting | In development (octopod) | In production |
|---|---|---|
| the issuer | `${OIDC_ISSUER_BASE}/<name>`, e.g. `http://id.shop.octopod.localhost/entra` | the provider's issuer URL (table below) |
| the client id | anything (`app`) | the id of the app's registration at the provider |
| the client secret | anything | the secret of that registration, from your secret store — never the repository |

octopod sets `OIDC_ISSUER_BASE` in the app's container. Let the app read a full `OIDC_ISSUER`
and, when it is not set, build it from `OIDC_ISSUER_BASE` and the issuer name you mirror:

```python
OIDC_ISSUER = os.environ.get("OIDC_ISSUER") or f"{os.environ['OIDC_ISSUER_BASE']}/entra"
```

**2. The app finds the endpoints by discovery**, `<issuer>/.well-known/openid-configuration`:
it never writes `/authorize` or `/token` itself. octopod's paths and the real provider's
differ (`/oauth2/v2.0/authorize` at Microsoft, `/protocol/openid-connect/auth` at Keycloak);
discovery gives each its own, and the signing keys (`jwks_uri`) with them. Most libraries do it
from the issuer alone (`mozilla-django-oidc` needs its endpoint settings filled from it).

**3. The app reads only the claims the real provider sends.** Name the development issuer
after it, and give its users the same claims, in the same claim:

| Provider | Issuer in production | Its groups, roles | In development |
|---|---|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` | `groups` (object ids, once *Token configuration → groups claim* is on), or app roles in `roles` | issuer `/entra`; `groups-claim: roles` for app roles |
| Google | `https://accounts.google.com` | none: Google sends `email`, `email_verified`, `hd` (the Workspace domain); roles stay the app's | issuer `/google`; users with `email` and `hd`, no groups |
| Keycloak | `https://<host>/realms/<realm>` | `groups` with a *Group Membership* mapper (full path off), realm roles in `realm_access.roles` | issuer `/keycloak` |
| Authentik | `https://<host>/application/o/<app-slug>/` (the trailing `/` is part of it) | `groups`, in the `profile` scope | issuer `/authentik` |
| Okta | `https://<org>.okta.com/oauth2/default` | `groups`, once a groups claim is added to the authorization server | issuer `/okta` |

**At the provider, before the first deployment:**
- Register the app (a "web application" client) and its **redirect URI**, exactly as the app
  sends it: `https://shop.example.com/oidc/callback/`. The development provider takes any
  redirect URI; the real one refuses all the others. Try the real URI early, on a staging host.
- Ask for the scopes the claims come with: `openid email profile`, plus the provider's own
  for groups when it has one.
- The issuer is compared character for character with a token's `iss`: copy it from the
  provider's discovery document, trailing slash included.
- Sign-out (`end_session_endpoint`), token lifetimes and refresh tokens are the provider's:
  read them from discovery, and test them against it.

**What the development provider does that a real one never will**: it takes any client id
and secret and any redirect URI, it signs whatever claims a user is given, and anyone on the
machine signs in as anyone. Nothing in the app should depend on that.

## What it is not

A development provider: it trusts any client and any redirect, and signs whatever claims
it is told. It answers on loopback, behind the edge, like every project; never let a real
service trust it. The provider itself, its endpoints and how it is built:
[src/oidc/README.md](../src/oidc/README.md).
