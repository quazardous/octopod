# Contract

Version 1. What a project declares, what octopod does with it, and the API clients use.

## The declaration: `octopod.yaml`

Next to the project's own compose file(s). Everything but `expose` is optional.

```yaml
project: demo              # DNS label; default: the folder name, slugified
compose:                   # default: the first of compose.yaml / compose.yml / docker-compose.yaml / docker-compose.yml,
                           # then its override (compose.override.yaml …) when present — as compose does without -f;
                           # declared, the list is taken as is
  - docker-compose.yml
expose:
  - service: web           # a service of the compose project
    port: 3000             # optional: the port it listens on, inside its container
  - service: api
    host: api              # served at api.demo.localhost; default: demo.localhost
```

**The port** is found when not declared, and never blocks `up`: the service's `expose` or
`ports` in the compose file, else its image's `EXPOSE` (pulled or built first when
missing), else 80. When a source offers several, the likeliest web port wins (80, 8080,
3000, 8000, 5173, …), then the lowest. `status` gives each route's `port` and
`portSource` (`declared`, `compose`, `image`, `guess`), and a warning when octopod had to
choose or guess — `port:` settles it.

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
     (generated, kept in octopod's state directory, not in the project) adds to each
     exposed service the labels below and the network `octopod-<project>-edge` —
     **`internal`**: Traefik reaches the service over it, and it is no way out to the
     internet for a project that declared none;
  2. the edge is connected to that network.
- **Data**: each of the project's own named volumes (not external, local driver, no
  options of its own) is bound to `<root>/.octopod/data/<volume>`, created by octopod as
  the operator, with `<root>/.octopod/.gitignore` (`*`) so git leaves it alone. This is the
  only thing octopod writes into a project. When a volume of the same name already exists
  in Docker's storage, `up` refuses and says how to move its data: binding over it would
  hide it.
- **Down**: the edge is disconnected, then `docker compose … down`. `volumes: true`
  removes the Docker volume objects; the data in `.octopod/data` is the project's and
  stays.
- **Ownership**: `status` reports, in `warnings`, each data folder holding files the
  operator does not own — a service writing as root leaves files only root can delete.
  octopod does not force a user on an image.

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
| POST | `/v1/projects/:name/restart` | `{ service? }` | `ProjectStatus` |
| POST | `/v1/projects/:name/exec` | `{ service, argv: string[], timeoutMs? }` | `{ ok, output, truncated }` — argv, never a shell string built by octopod; output bounded |
| GET | `/v1/projects/:name/logs?service=&tail=` | | `{ lines: string[] }` |
| DELETE | `/v1/projects/:name` | | `{}` (brought down first) |

```ts
interface Project {
  name: string; root: string; compose: string[];
  routes: { service: string; url: string; port?: number; portSource?: 'declared' | 'compose' | 'image' | 'guess' }[];
}
interface ProjectStatus extends Project {
  services: { service: string; state: string; health?: string }[];
  warnings?: string[];
}
```

The CLI speaks the same operations and prints the same JSON with `--json`:
`octopod edge up|down|status`, `octopod register [dir]`, `octopod up|down|status|logs|restart
[project]`, `octopod exec <project> <service> -- <command…>`, `octopod unregister <project>`,
`octopod serve` (the API). `OCTOPOD_STATE_DIR`, `OCTOPOD_INSTANCE` and `OCTOPOD_PORTS` select
another instance (tests, a second edge).
