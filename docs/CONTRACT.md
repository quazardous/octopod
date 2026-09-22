# Contract

Version 1. What a project declares, what octopod does with it, and the API clients use.

## The declaration: `octopod.yaml`

Next to the project's own compose file(s). Everything but `expose` is optional.

```yaml
project: demo              # DNS label; default: the folder name, slugified
compose:                   # default: compose.yaml / compose.yml / docker-compose.yaml / docker-compose.yml
  - docker-compose.yml
expose:
  - service: web           # a service of the compose project
    port: 3000             # the port it listens on, inside its container
  - service: api
    port: 8080
    host: api              # served at api.demo.localhost; default: demo.localhost
```

Rules, checked when the project is registered and every time it is brought up:

- `project` is a DNS label (`[a-z0-9-]`, at most 63, not starting or ending with `-`).
- `host` is empty (the project's own name) or a sequence of labels **under** it: a
  project can never serve a name outside `<project>.localhost` and `*.<project>.localhost`.
- Every `service` exists in the compose configuration; every host is used once.

## What octopod does

- **The edge**: one Traefik (`traefik:v3.6.1`), container `octopod-edge`, published on
  `127.0.0.1:<port>` — 80 when free, 8480 otherwise (the choice is kept). Docker socket
  read-only. Only containers labelled `octopod.edge=1` are considered.
- **A project**, brought up:
  1. `docker compose -p <project> -f <its files> -f <override> up -d`, where the override
     (generated, kept in octopod's state directory, never in the project) adds to each
     exposed service the labels below and the network `octopod-<project>-edge`;
  2. the edge is connected to that network.
- **Down**: the edge is disconnected, then `docker compose … down`. Volumes are kept
  unless asked.

Labels generated on an exposed service (never written by hand):

```
octopod.edge=1
octopod.project=<project>
traefik.enable=true
traefik.docker.network=octopod-<project>-edge
traefik.http.routers.<project>-<service>.rule=Host(`<host>.localhost`)
traefik.http.routers.<project>-<service>.entrypoints=web
traefik.http.routers.<project>-<service>.service=<project>-<service>
traefik.http.services.<project>-<service>.loadbalancer.server.port=<port>
```

## The API

HTTP with JSON bodies over a unix socket: `$XDG_RUNTIME_DIR/octopod/octopod.sock`
(`0600`). Errors are `{ "error": string }` with a 4xx or 5xx status.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/v1/edge` | | `{ running, port, dashboard }` |
| POST | `/v1/edge/up` · `/v1/edge/down` | | `{ running, port, dashboard }` |
| GET | `/v1/projects` | | `Project[]` |
| POST | `/v1/projects` | `{ root }` | `Project` (registered from `root/octopod.yaml`) |
| GET | `/v1/projects/:name` | | `ProjectStatus` |
| POST | `/v1/projects/:name/up` · `/down` | `{ volumes?: boolean }` for down | `ProjectStatus` |
| GET | `/v1/projects/:name/logs?service=&tail=` | | `{ lines: string[] }` |
| DELETE | `/v1/projects/:name` | | `{}` (brought down first) |

```ts
interface Project { name: string; root: string; routes: { service: string; url: string }[] }
interface ProjectStatus extends Project {
  services: { service: string; state: string; health?: string }[];
}
```

The CLI speaks the same operations and prints the same JSON with `--json`:
`octopod edge up|down|status`, `octopod register [dir]`, `octopod up|down|status|logs
[project]`, `octopod unregister <project>`, `octopod serve` (the API).
