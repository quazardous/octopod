# Patterns

What ten Docker + Traefik development setups on one machine have in common, what they
learned the hard way, and what octopod does about it. Surveyed read-only; the projects
are left as they are.

## The shape they share

Each project ships its own Traefik: a `docker/traefik/traefik.yaml` copied from a
versioned template (`traefik.yaml-dist` or `-docker`), a `traefik` service in the
project's compose file, and a network named after the project (`<name>_traefik`).

The provider configuration is the same everywhere:

```yaml
providers:
  docker:
    exposedByDefault: false
    constraints: "Label(`dev.project`, `<name>-1`)"
    network: <name>_traefik
```

and every routed service carries `dev.project=${DEV_PROJECT}` next to its
`traefik.*` labels, with router names prefixed by `${DEV_PROJECT}` so two instances of one
project do not collide.

## Lessons already paid for

- **`exposedByDefault: false` is not enough.** It only skips containers *without*
  `traefik.enable=true` — and every project's routed containers carry it, for their own
  Traefik. The Docker socket shows them all, so each Traefik adopted its neighbours'
  routers (39 in one case). They do not work — Traefik is not on their networks — so the
  request hangs instead of failing, and each start logs dozens of errors about other
  projects. The fix is a **`constraints` rule on an exact label value**, not a regex: a
  pattern would make one instance adopt another's containers.
- **Name the provider's network.** A container on several networks is otherwise reached
  through whichever one Traefik picks.
- **The constraint can only be set in the static file.** Environment variables and
  command-line flags for it were tried and had no effect once the file existed.
- **HTTP on `*.localhost` is enough.** It resolves to loopback without DNS setup, and
  browsers treat it as a secure context. Local HTTPS costs a local CA in every browser
  and certificates to renew, for traffic that never leaves the machine.
- **`host.docker.internal` needs `extra_hosts: host-gateway` on Linux** to route to
  something running on the host (a dev server outside Docker).
- **A route to a port that moved fails as a 502, not at start-up** — pin the ports routes
  point at, so the failure is loud.

## What is still left to each project

| Pain | Seen |
|---|---|
| Port 80 (or 443) wanted by default | 8 of 9 — only one project can run at a time; the others override `EXTERNAL_HTTP_PORT` by hand |
| Published on every interface (`80:80`) | all of them |
| Docker socket mounted read-write | 7 of 9 — the socket is root on the host; Traefik only needs to read it |
| Dashboard with `insecure: true` | all of them |
| The Traefik block, template and network copied into every project | all of them |

## What octopod does instead

- **One Traefik for the machine**, bound to `127.0.0.1` only, on port 80 when it is free
  and a fixed fallback otherwise — projects stop competing for it.
- **Docker socket read-only**; dashboard reachable only through a router on
  `traefik.localhost`, never on an open API port.
- **One exact label for everything octopod manages** (`octopod.edge=1`), so the shared
  Traefik never adopts a container it was not given — including every project still
  running its own Traefik.
- **Projects declare what to expose** (service, port, host) and octopod generates the
  labels and networks as a compose override: nothing Traefik-specific in the project.
- **One edge network per project**, with Traefik connected to each: Traefik reaches
  every project, projects do not reach each other. A single shared network would let
  any project's containers talk to any other's.
- **Hosts are scoped to their project**: a project named `demo` can serve `demo.localhost`
  and `*.demo.localhost`, nothing else — one project cannot take another's name.
