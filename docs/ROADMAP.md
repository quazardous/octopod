# Roadmap

octopod started as the environment composer of bushwhack, a bridge that lets a web-chat
model work on a local project. It became its own project because every Docker + Traefik
project on a machine needs the same thing.

Scope: Traefik and Docker composition, nothing else. What the containers run and what
their environment files hold is the business of the tools that use octopod — secret
handling, in particular, stays in those tools.

## 1. Survey the patterns already in use

Read-only review of existing Docker + Traefik development setups: the conventions that
work (a `dev.project` label per instance, `DEV_PROJECT` and `SITE_BASE_DOMAIN` variables,
versioned templates copied to local files), and the traps already paid for:

- `exposedByDefault: false` is not enough: a Traefik still adopts the routers of every
  other project's containers that carry `traefik.enable=true`, and requests to them hang
  because it is not on their networks. Filter with a `constraints` rule on an exact label.
- Set the provider's `network` explicitly, or Traefik picks one at random for containers
  on several networks.
- Mount the Docker socket read-only.
- HTTP on `*.localhost` needs no certificate: it resolves to loopback and browsers treat
  it as a secure context. Local HTTPS means a local CA in every browser, for traffic that
  never leaves the machine.
- `host.docker.internal` needs `extra_hosts: host-gateway` on Linux.

Deliverable: `docs/PATTERNS.md`.

## 2. The contract

- The project declaration: name, services to expose (host, port).
- The API: `projects list|register|up|down|status|logs|routes`, `edge status|restart` —
  JSON schemas, versioned.

## 3. MVP

The shared edge (Traefik on `127.0.0.1:80`, fallback port when taken, label constraint,
per-project edge networks connected to it), registration, the generated compose
override. One existing project migrated as the pilot, its own Traefik removed.

## 4. Clients

bushwhack's `app:*` tools built on the API.

## Technology

TypeScript on Node 22: the API decouples clients from the implementation language, and
the first client and the existing composer are TypeScript. Go (single binary, Docker's
own ecosystem) is the alternative to weigh before a first release.
