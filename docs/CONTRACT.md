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
env_file: compose.env      # optional: variables for the compose files, inside the project; compose's own .env otherwise
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
- **Instances**: a project can run more than once — the `-1` of `<project>-<service>-1`.
  Instance 1 is the project itself; instance N (`--instance N`, `instance` in the API)
  is the same folder and compose files under the name `<project>-N`: its own containers
  (`<project>-N-<service>-1`), its own edge network, `<project>-N.localhost` (and
  `api.<project>-N.localhost`), and its data in `.octopod/data/N/`. `status` of the project
  lists its other instances up; `down --instance N` stops that one alone; `unregister`
  stops them all. A project cannot run twice when its compose fixes a `container_name`
  or publishes a fixed host port, or when `<project>-N` is itself a registered project:
  `up` says which.
- **Environment**: docker gets only what it needs of octopod's own environment (`PATH`,
  `HOME`, locale, `XDG_RUNTIME_DIR`, `DOCKER_*`, `BUILDX_*`, `SSH_AUTH_SOCK`) — never a
  `COMPOSE_*` or any other variable of the calling shell, which a compose file would
  otherwise interpolate unseen. A project's variables come from its `.env`, or from its
  declared `env_file` (passed as `--env-file`). The override never adds an `environment`.
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

## Recipes

A recipe is a folder: `<id>/recipe.yaml`, and its `Dockerfile` when it builds. Folders,
from the most general to the closest (the closest wins a name, `octopod recipes` says
which one it hides): octopod's own `recipes/`, `OCTOPOD_RECIPES` (PATH-like), the
declaration's `recipes:` (relative to the project), the project's `.octopod/recipes/`.

```yaml
services:                  # instead of, or beside, the project's own compose files
  app: { recipe: node-app }
  db:  { recipe: postgres, persist: true, db: shop }   # parameters, typed by the recipe
recipes: [../shared-recipes]
workspace: .               # the folder a recipe's workspace mounts; the project's by default
```

- Rendered into `.octopod/recipes.<project>.json`, first of the compose files, with each
  build context in `.octopod/build/<service>/` (the Dockerfile alone).
- A recipe decides everything its service gets; the project gives a service name, a
  recipe id and typed parameters — an unknown parameter, a wrong type or a value for a
  generated secret is refused.
- Built images get BASE_IMAGE, UID, GID and USER_NAME (the project's name, made a valid
  Linux user name). Secrets are generated once and kept in octopod's state (`0600`),
  never in the project.
- Routed recipes are exposed without an `expose` entry, at the project's host or their
  subdomain; two wanting the same host is an error. Their profiles are activated.
- The recipe's digest covers its Dockerfile. `octopod plan [dir]` renders without writing
  anything, for an approval.
- No networks and no hardening: a client with stricter needs adds its own compose file.
- `unregister` removes the images compose built for the project.

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
| POST | `/v1/projects/:name/exec` | `{ service, argv: string[], timeoutMs? }` | `{ ok, mode, output, truncated }` — argv, never a shell string built by octopod; output bounded; a failure says how it ended (exit code, timeout). `mode: "run"` when the service was not running (stopped, restarting in a loop): the command ran in a one-off container of it (same image, mounts, user, network), kept out of the edge's routes |
| GET | `/v1/projects/:name/logs?service=&tail=` | | `{ lines: string[] }` |
| GET | `/v1/recipes?root=` | | `{ recipes: {id,title,summary,dir,digest}[], shadowed: {id,dir,by}[] }` |
| POST | `/v1/plan` | `{ root, instance? }` | `{ project, text, services, compose }` — writes nothing |
| DELETE | `/v1/projects/:name` | | `{}` (brought down first) |

```ts
interface Project {
  name: string; root: string; compose: string[];
  routes: { service: string; url: string; port?: number; portSource?: 'declared' | 'compose' | 'image' | 'guess' }[];
}
interface ProjectStatus extends Project {
  instance?: number;        // this status is of instance N
  instances?: number[];     // the project's other instances up (on instance 1's status)
  services: { service: string; state: string; health?: string }[];
  warnings?: string[];
}
```

The CLI speaks the same operations and prints the same JSON with `--json`:
`octopod edge up|down|status`, `octopod register [dir]`, `octopod up|down|status|logs|restart
[project]`, `octopod exec <project> <service> -- <command…>`, `octopod unregister <project>` —
`up`, `down`, `status`, `logs`, `restart` and `exec` take `--instance N`;
`octopod serve` (the API). `OCTOPOD_STATE_DIR`, `OCTOPOD_INSTANCE` and `OCTOPOD_PORTS` select
another instance (tests, a second edge).
