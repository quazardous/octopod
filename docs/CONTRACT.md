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
group: m2m                 # optional: a DNS label, to find the project among the others
tags: [php, legacy]        # optional: DNS labels, up to 16
expose:
  - service: web           # a service of the compose project
    port: 3000             # optional: the port it listens on, inside its container
  - service: api
    host: api              # served at api.demo.octopod.localhost; default: demo.octopod.localhost
```

**The port** is found when not declared, and never blocks `up`: the service's `expose` or
`ports` in the compose file, else its image's `EXPOSE` (pulled or built first when
missing), else 80. When a source offers several, the likeliest web port wins (80, 8080,
3000, 8000, 5173, …), then the lowest. `status` gives each route's `port` and
`portSource` (`declared`, `compose`, `image`, `guess`), and a warning when octopod had to
choose or guess — `port:` settles it.

Rules, checked when the project is registered and every time it is brought up:

- `project` is a DNS label (`[a-z0-9-]`, at most 63, not starting or ending with `-`).
- `host` is empty (the project's own domain) or a sequence of labels **under** it: a
  project can never serve a name outside its domain and the names under it. Its domain is
  `<project>.octopod.localhost`, or `<project>.group-<group>.octopod.localhost` in a group; a
  group's shared services are at `group-<group>.octopod.localhost`, the machine pool's (group
  `default`) at `octopod.localhost`, which is also the console's (Traefik's dashboard is
  `traefik.octopod.localhost`).
- A project without a group may not take a name of that top level: `octopod`, `traefik`,
  `api`, `console`, `group-…`, nor a built-in recipe's route (`pma`, `mail`, `id`, `mongo`,
  `redis`). A group's name is at most 57 characters (`group-<group>` is a label).
- Every `service` exists in the compose configuration; every host is used once.

## What octopod does

- **The edge**: one Traefik (`traefik:v3.6.1`), container `octopod-edge`, published on
  `127.0.0.1:<port>` — 80 when free, 8480 otherwise (the choice is kept). Docker socket
  read-only. Only containers labelled `octopod.edge=<instance>` (`octopod.edge=octopod` for
  the default instance) are considered: another octopod edge on the machine — a test, a
  second instance — never sees this one's containers, nor this one its.
- **The edge's own pages**, reachable from the host only — a project's containers reach the
  edge over their edge network, and get a 403 there:
  - `http://traefik.octopod.localhost`: Traefik's dashboard;
  - `http://octopod.localhost`: the console — every project and instance, its services,
    routes, warnings and logs, and a button to bring each up or down. Served by `octopod
    serve` (the API), through `octopod-console`, a relay (nginx, running as the operator,
    read-only, no capability) that passes GET to the API's socket, and
    `POST /v1/projects/:name/up` and `/down` when they carry the header
    `X-Octopod-Console: 1`, which a page of another site cannot add (it would need a CORS
    preflight the relay never answers); every other method and path is refused. It shows
    nothing but its login to a browser not enrolled: see *The console's enrollment*. When the API is
    not running, the console says how to start it. The relay mounts the socket's folder
    without letting Docker create it (`create_host_path: false`): after a reboot Docker
    starts the relay before octopod's service, and a folder it made would be root's; the
    relay waits instead, and `octopod serve` starts it once it listens. On Windows the relay
    reaches the API on the host's loopback (`host.docker.internal`), adding its token.
  - any other name, one no router takes: the relay's last-resort router (`octopod-lost`,
    `HostRegexp(.+)`, priority 1) passes it to the API as `GET /v1/lost`, the name asked
    for in `X-Octopod-Lost`. The answer is a `404` that says no route answers that name,
    or, for a name of the addressing before 0.7.0 (`<host>.<project>.localhost`) that a
    registered project had, where it is now. No redirect: what keeps the old name (an
    app's allowed hosts, CSRF origins, OIDC redirect URIs, scripts) has to change anyway.

  "From the host" is a Traefik middleware (`octopod-local`, in the file provider): the
  edge's own network, where the host's requests come from through the published port.
  The names `octopod` and `traefik` are the edge's: no project can take them.
- **A project**, brought up:
  1. `docker compose -p <project> -f <its files> -f <override> up -d`, where the override
     (generated, kept in octopod's state directory, not in the project) adds to each
     exposed service the labels below and the network `octopod-<project>-edge` —
     **`internal`**: Traefik reaches the service over it, and it is no way out to the
     internet for a project that declared none;
  2. the edge is connected to that network, under each of the project's hosts as an alias
     (`demo.octopod.localhost`, `api.demo.octopod.localhost`): inside the project's exposed services,
     Docker's DNS answers them with the edge, so a container reaches its project's hosts
     at the URLs a browser on the host uses (an OIDC issuer, an app calling its own API).
     The edge listens inside on the port it is published on, so `:8480` works on both
     sides. A service that is not exposed is not on that network: it joins
     `octopod-<project>-edge` in the project's compose to reach them.
- **Data**: each of the project's own named volumes (not external, local driver, no
  options of its own) is bound to `<root>/.octopod/data/<volume>`, created by octopod as
  the operator, with `<root>/.octopod/.gitignore` (`*`) so git leaves it alone. This is the
  only thing octopod writes into a project (a group's shared services keep theirs in
  octopod's state). When a volume of the same name already exists
  in Docker's storage, `up` refuses and says how to move its data: binding over it would
  hide it.
- **Up removes orphans**: a service the project's files no longer declare (one now shared
  by its group, one deleted) has its container taken away on `up`; its data stays.
- **Down**: the edge is disconnected, then `docker compose … down`. `volumes: true`
  removes the Docker volume objects; the data in `.octopod/data` is the project's and
  stays.
- **Instances**: a project can run more than once — the `-1` of `<project>-<service>-1`.
  Instance 1 is the project itself; instance N (`--instance N`, `instance` in the API)
  is the same folder and compose files under the name `<project>-N`: its own containers
  (`<project>-N-<service>-1`), its own edge network, `<project>-N.octopod.localhost` (and
  `api.<project>-N.octopod.localhost`; in a group, under `group-<group>.octopod.localhost`), and its data in `.octopod/data/N/`. `status` of the project
  lists its other instances up; `down --instance N` stops that one alone; `unregister`
  stops them all. A project cannot run twice when its compose fixes a `container_name`
  or publishes a fixed host port, or when `<project>-N` is itself a registered project:
  `up` says which.
- **Environment**: docker gets only what it needs of octopod's own environment (`PATH`,
  `HOME`, locale, `XDG_RUNTIME_DIR`, `DOCKER_*`, `BUILDX_*`, `SSH_AUTH_SOCK`) — never a
  `COMPOSE_*` or any other variable of the calling shell, which a compose file would
  otherwise interpolate unseen. A project's variables come from its `.env`, or from its
  declared `env_file` (passed as `--env-file`). The override never adds an `environment`.
- **The project's mounted folders**: before `up`, each bind-mount source inside the project
  that does not exist (`./dataset:/data` in the project's compose file) is created as the
  operator — Docker would create it as root. A source outside the project is not octopod's
  to create. `status` warns about one the operator does not own.
- **Ownership**: `status` reports, in `warnings`, each data folder holding files the
  operator does not own — a service writing as root leaves files only root can delete —
  and each running service whose main process runs as root, read from the process itself
  (`/proc/<pid>/status` on Linux), whatever the image's `USER` or the compose file's `user:`
  said. octopod does not force a user on an image.

Labels generated on an exposed service (never written by hand):

```
octopod.edge=<instance>        # octopod, unless OCTOPOD_INSTANCE says otherwise
octopod.project=<project>
traefik.enable=true
traefik.docker.network=octopod-<project>-edge
traefik.http.routers.<project>-<service>.rule=Host(`<host>.octopod.localhost`)
traefik.http.routers.<project>-<service>.entrypoints=web
traefik.http.routers.<project>-<service>.middlewares=octopod-from-<project>@file
traefik.http.routers.<project>-<service>.service=<project>-<service>
traefik.http.services.<project>-<service>.loadbalancer.server.port=<port>
```

`octopod-from-<project>` lets through the host and the project's own containers (its edge
network), and nothing else: another project's container that sends this project's host to
the edge gets a 403. A group's shared services (`<group>-shared`) also answer the projects
that use them. octopod writes it in the edge's dynamic configuration when the project comes
up; until then the project's routes answer nothing.

## Layering

`up` passes compose its files in a fixed order, which a project can rely on: later files
win, as in compose itself.

1. the recipes, rendered (`.octopod/recipes.<project>.json`), when the project names any;
2. the project's own compose files, its `compose.override.yaml` included;
3. octopod's override, kept in octopod's state.

So a project overrides anything a recipe decides — image, command, volumes, environment,
limits, `working_dir`, labels — from its own compose file; to replace a list rather than
merge it, compose's `!reset` and `!override` apply. octopod's override comes last, and
keeps: the edge's label, the project's edge network, the routing labels of `expose`, and
the binding of named volumes to `.octopod/data`. A project adds to them rather than
removing them: its own Traefik labels (a router of its own, pointing at a service octopod
generated, named `<project>-<host label>`), its own networks. Labels written by hand are not
held to the rule that a project serves only names under `<project>.octopod.localhost`: that rule
is `expose`'s.

A service may be exposed under several hosts: one `expose` entry per host, each with its
router and its Traefik service.

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
  Linux user name), plus the recipe's `buildArgs`, made of its params — never of its
  secrets, which would stay in the image's history.
- Param types: `enum`, `ident`, `int`, `bool`, `secret` (generated), and `set` — several
  of the values the recipe lists (`extensions: [intl, gd]` in `octopod.yaml`), rendered
  space-separated.
- A recipe's image may name an **enum** param, and only that: `php:{{params.php}}-fpm`
  with `php` one of the versions the recipe lists. A project picks among them; it never
  writes an image. Secrets are generated once and kept in octopod's state (`0600`), with
  a copy beside the data they unlock, `.octopod/secrets.<project>.json` (`0600`,
  git-ignored with the rest of `.octopod/`): a project whose state was lost (another
  machine, `uninstall --purge`) gets its passwords back from it instead of new ones. Where
  both hold a value and they differ, the state's is used, the copy is left as it is, and
  `status` and `doctor` say so. A secret is never replaced once kept.
- Routed recipes are exposed without an `expose` entry, at the project's host or their
  subdomain; two wanting the same host is an error. `route: false` on a service turns its
  recipe's route off (a worker that serves nothing over HTTP). Their profiles are activated.
- A built image is labelled `octopod.build` with a digest of what it is built from — the
  recipe, its Dockerfile, the build's arguments — and `octopod.project`. `up` builds again
  the services whose label no longer matches (compose alone builds only a missing image),
  then removes the images they replaced.
- The recipe's digest covers its Dockerfile. `octopod plan [dir]` renders without writing
  anything, for an approval.
- No networks and no hardening: a client with stricter needs adds its own compose file.
- **Capabilities** connect recipes: a recipe `provides` some, another `requires` them and
  gets the provider's `exports` as variables. The built-in ones: `sql` (`postgres`,
  `mariadb`: `url`), `mysql` (`mariadb`: `host`, `port`, `user`, `password`, `db`),
  `redis` (`redis` and `valkey`: `url`), `memcached` (`url`), `mongodb` (`url`), `smtp`
  (`mailpit`: `url`), `oidc` (`oidc`: `issuer_base`). `php-app`, `node-app` and `python-app` require each of them optionally (`DATABASE_URL`, `REDIS_URL`,
  `MEMCACHED_URL`, `MONGODB_URL`, `MAILER_DSN` and `SMTP_URL`, `OIDC_ISSUER_BASE`); `phpmyadmin` requires
  `mysql`, `mongo-express` requires `mongodb`, `redis-commander` requires `redis`. Two
  providers of one capability a service requires is an error: name the one you mean in a
  recipe of your own.
- **An admin beside it.** A recipe's `admin:` names the recipe octopod runs beside its
  service when the project runs none of it: `<service>-admin`, wired to it. `redis` and
  `valkey` name `redis-commander`. It is not added for a group's shared service (the group's
  stack has its own), nor when two services provide what the admin requires.
- **A shell like a machine's.** An app recipe with `home: true` (`node-app`, `php-app`,
  `php-cli`) gives its shell octopod's settings — the prompt says `<user>@<project>:<service>`
  (red as root), a history that lasts, `ll`/`la` — from `.octopod/bashrc`, mounted
  read-only at `/etc/octopod/bashrc`, which the image's `/etc/bash.bashrc` sources; the
  user's own `~/.bashrc` comes after. The service gets `OCTOPOD_PROJECT` and
  `OCTOPOD_SERVICE` for it. Per service in `octopod.yaml`:
  - `home: true` keeps its user's home (`/home/<user>`: history, caches, tools' settings)
    in `.octopod/home/<service>` (`.octopod/home/<N>/<service>` for instance N), created as
    the operator; `home: <folder>` keeps it in that folder of the project, which must exist
    (a home kept in git, as some projects do).
  - `workdir: /my-app` mounts the project there instead of the recipe's workspace (`/app`):
    a project keeps the paths it has. It is passed to the build as `WORKSPACE` (php-app
    serves its docroot from it).
- **Where the console's icon leads.** A routed recipe's icon leads to its route, at the
  recipe's `link:` (`/admin/` for `oidc`); a database's, to the admin wired to it. An app's
  (a recipe with a workspace: its address is listed beside it) leads to its info page: what
  its recipe's `info` action reads in the running container — `python-app`, `php-app` and
  `node-app` have one (the runtime, its packages, the environment, the programs; sections
  start with `## `, a name and its value split by a tab). `link:` on a service in
  `octopod.yaml` says otherwise: a path on its route (`/__debug__/`), or an http(s) URL.
- **A service's address.** `{{url}}` in a recipe's `env`, `exports`, `command` or health is a
  routed service's address at the edge (`http://id.demo.octopod.localhost`, with `:<port>` when
  the edge is not on 80), empty for a service not routed: the same URL from the host's
  browser and from the project's containers.
- **A group's shared services.** A service the group runs instead of the project: one
  server for all the group's projects instead of one each. Which ones:
  - `shared: [mariadb, oidc]` at the top of `octopod.yaml` names recipes; `shared: true`
    means the databases (`mariadb`, `postgres`, `mongodb`). Without it, the machine's
    default applies: `octopod share true`, `octopod share mariadb oidc`, `octopod share
    --off` (none, the default), kept in octopod's state.
  - On a service, `shared: true` or `shared: false` decides for that service alone.
  - A project with no `group:` shares with the machine's pool, the group `default`.

  octopod runs a group's shared servers as a project of their own, `<group>-shared`, made in
  its state directory (`<state>/groups/<group>/`, data included: it belongs to no one
  project), brought up before the first project that uses them and down after the last
  one. There is one server per recipe and way of asking: its recipe and version
  (`mariadb-11-4`, `mariadb-10-11`) and, when other params differ from the recipe's
  defaults, a digest of them; so projects on two versions never meet. Each project has its
  own network to them, `octopod-<group>-shared-<project>` (internal), joined by its services
  that require them, where each server answers to the project's own name for it (`db`): an
  app's `DATABASE_URL` is unchanged, and nothing of the group's other projects is reachable.
  A service made shared keeps its former data in the project's `.octopod/data`; `status`
  says so, and octopod does not move it.
  - A recipe says how it is shared in `tenant:`: the params each project gets
    (`{{tenant}}` is the project's name) and the secret it gets its own value of; its
    `command` makes the tenancy in the running service, alike each time, with the name in
    `$TENANT` and the secret on its standard input. `mariadb` and `postgres` give each
    project its own database and user, granted on that database alone: the app's
    `DATABASE_URL` is the same shape as unshared. A recipe without `tenant:` (`mailpit`,
    `phpmyadmin`, `oidc`) is shared as it is.
  - A shared service keeps its actions in the project: `octopod run db shell|dump|load|reset`
    runs the recipe's action in the group's server, with `tenant.env` in its environment
    instead of the server's own (`MARIADB_USER`, `MARIADB_DATABASE`, `MARIADB_PASSWORD`:
    the project's names, and its secret as `{{secret}}`), given through docker's
    environment (`exec -e NAME`), never on a command line. `tenant.actions` replaces the
    actions a tenant does otherwise (postgres's `reset` empties the database it owns: a
    tenant may not create one).
- **The `oidc` recipe** runs octopod's own OpenID Connect provider (`src/oidc`): any first
  path segment is an issuer (`<issuer_base>/admi`), named after the address the request
  came to; its login page takes a user name and the claims to sign. Any client id, any
  client secret: a development provider. It keeps users (claims, a password as a scrypt
  hash) and groups (claims given to their members; a user's groups signed in `groups`, or
  the `groups-claim` param), managed at `/admin` and its API (`/admin/api/users`,
  `/admin/api/groups`, `GET /admin/api/session` → `{ open, token? }`; with the admin token
  always, `POST /admin/api/sign-in` `{ sub | claims, issuer? }` → `{ ticket, expires_in }`, a
  single-use sign-in that an issuer's `authorize` takes as `login_ticket`, or from the cookie
  `GET /sign-in?ticket=&next=` sets, and `POST /admin/api/tokens` `{ sub | claims, issuer?,
  client_id?, scope? }` → tokens), which ask for nothing unless `admin-login: true`, then for the service's
  `admin-token` secret (`octopod secrets`); `octopod oidc users|user|remove|groups|group|session|link|token [project]`
  manages them from the command line, the project's provider or its group's; params `password-grant`
  (a CI signs in with no browser) and `open-login: false` (only the admin's users). Its signing key is kept in `.octopod/data/<service>-keys`.
- **The host, in an env.** A recipe's `env` (and a requirement's) may read `{{host.os}}`
  (`linux`, `windows`, `macos`) and `{{host.poll}}` — `true` where a change made on the host
  raises no file event in a container (Docker Desktop on Windows), empty elsewhere. An env
  entry rendered empty is left out of the service: a watcher takes any value, `false`
  included, as yes. Nowhere else: an image, a build or a command that changed with the
  machine would make one project run differently on two. `node-app` sets
  `CHOKIDAR_USEPOLLING` and `WATCHPACK_POLLING` from `{{host.poll}}`.
- **Actions.** A recipe names commands for its running service (`actions:`), and a
  project may add its own per service in `octopod.yaml`, the same shape, winning a name
  they share: `command` (argv, templated with `{{params.x}}` and `{{service}}` only — a
  secret is read in the container from the service's environment, never put on the host's
  command line; one named is refused), `summary`, `input` (it reads a file or stdin),
  `tty` (interactive, CLI only), `confirm` (what it destroys: asked, or `--yes`).
  `octopod run [project] <service>` lists them, `octopod run [project] <service> <action>
  [file]` runs one in the service (a tool's in a one-off container): its output on the
  standard output, its input from the file or stdin. `mariadb`, `postgres` and `mongodb`
  have `shell`, `dump`, `load` and `reset`.
- **Tools.** A recipe with `tool: true` (`php-cli`) makes a service run on demand only: in
  the `octopod-tool` compose profile, which octopod never activates, so `up` builds its
  image and never starts it; no restart policy, no route, no supervisor. `octopod shell
  <project> <tool> -- <command…>` and `exec` run it in a one-off container (the same
  image, mounts, user and network), removed once done. `status` lists it with the state
  `tool`, not as a service down; `down` and `unregister` take its image and leftovers with
  the rest.
- **Programs.** A recipe that runs supervisord says so (`supervisor: { config, programs }`:
  its configuration, and the programs it runs itself); `php-app` does. A service made of
  it takes `programs:` in `octopod.yaml`, run beside the recipe's own:

  ```yaml
  services:
    app:
      recipe: php-app
      programs:
        worker: { command: php bin/console messenger:consume async --time-limit=3600 }
        seed:   { command: php bin/console app:seed, autostart: false }
  ```

  A command is one line, split by supervisord (quotes, no shell), run in the workspace as
  the service's user. A program with `autostart` (the default) is a worker: started with
  the container, and started again whenever it ends, with supervisord's growing delay —
  never taking the container down. `autostart: false` makes a task: started by hand
  (`octopod program start`), done once it exits 0. They are rendered into
  `.octopod/programs.<project>.<service>.conf`, mounted read-only at
  `/etc/octopod/programs.conf`, which the recipe's configuration includes; a change of
  programs recreates the container. A name the recipe uses itself is refused, and so are
  programs for a recipe without a supervisor. `status` gives each running supervised
  service's `programs`, and warns about a program in `FATAL` or `BACKOFF`: the container
  is up, what should run in it is not.
- **A folder of supervisord files.** `supervisor_d: docker/supervisor` on such a service
  mounts that folder of the project, read-only, at `/etc/octopod/supervisord.d`, whose
  `*.conf` the recipe's configuration includes beside the rendered programs: a project
  that keeps its programs as supervisord files keeps them. The folder must exist in the
  project (docker would create a missing one, as root). supervisord reads them at start;
  after a file is dropped, changed or removed, `octopod program reload <service>` applies
  it (new programs started, changed ones restarted, removed ones stopped, the others left
  running). octopod does not read these files, so they keep to what the container is:
  no `user=` (supervisord already runs as the project's user, and cannot switch), logs to
  `/dev/stdout` (`stdout_logfile_maxbytes=0`), paths in the workspace, no
  `[supervisord]`, `[unix_http_server]` or `[inet_http_server]` section, and no name the
  recipe or `programs:` already uses — supervisord refuses a duplicate at start.
- **A recipe's Dockerfile** keeps to a few rules, which `octopod recipes --check [dir]`
  reads from its text (exit 1 on a problem; a help for whoever writes a recipe, not a gate
  on `up`): the final stage starts `FROM ${BASE_IMAGE}`; nothing is copied from the build
  context, which is the Dockerfile alone (`COPY --from=<stage>` and heredocs are fine); no
  `VOLUME` — data goes in the recipe's `volumes`, kept in `.octopod/data`; system packages
  and extensions, never a project's dependencies; the last `USER` is not root. A Dockerfile
  without `USER` is not flagged: a database image starts as root and drops to its own user.
- `unregister` removes the images compose built for the project. The secrets octopod
  generated for its recipes stay in its state while the project's `.octopod/data` exists:
  a database kept there opens only with them, and the project registered again (from the
  same folder or a moved one) finds them. Without that folder they go too.

## The API

HTTP with JSON bodies over a unix socket: `$XDG_RUNTIME_DIR/octopod/octopod.sock`
(`0600`). Errors are `{ "error": string }` with a 4xx or 5xx status.

On Windows, which has no unix sockets, the API listens on `127.0.0.1` instead, on the
port of `api.json` in the state directory (`{ "port": number, "token": string }`, made the
first time, kept after), and answers only a request that carries that token in the
`X-Octopod-Token` header; any other gets `401`. A client reads the file, as the operator.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/v1/version` | | `{ version, contract, features }` — octopod's version (semver), this contract's (`1`), and what it adds to it (`features`, from 0.2.0) |
| GET | `/v1/edge` | | `{ running, port, dashboard, console }` |
| POST | `/v1/edge/up` · `/v1/edge/down` | | `{ running, port, dashboard, console }` |
| GET | `/v1/projects?group=&tag=` | | `Project[]` — every registered project, or those of a group, or carrying a tag; a group's shared services (`<group>-shared`) are listed with `sharedOf: <group>`: not a project, the console shows them in the projects that use them |
| POST | `/v1/projects` | `{ root }` | `Project` (registered from `root/octopod.yaml`) |
| GET | `/v1/projects/:name` | | `ProjectStatus`; each of its `services` made of a recipe carries `recipe` (its id), `link` (where the console's icon leads: its route at the recipe's `link:`, or for a database the route of the admin wired to it) `app` (it works on the project's files), for an app `uses` (its own services it is wired to), for an admin `admin` (the service it administers: the console draws the two as one), `info` (it has an `info` action: `GET …/info`), `env` (the names of the variables it gets, each with the service it comes from: `{ name, from? }`, never the values). `shared`: the group's servers the project uses, `{ service, server, stack, state, health?, recipe, link?, admin? }` — `service` its own name for it, `server` the group's (`mariadb-11-4`), `stack` the group's stack that runs it (`<group>-shared`: its logs are there), `url` its address at the edge when routed |
| POST | `/v1/projects/:name/up` · `/down` | `{ volumes?: boolean, instance? }` for down, `{ instance? }` for up | `ProjectStatus` — the only POSTs the console's relay lets through, with `X-Octopod-Console: 1`; a down with `volumes: true` and that header is refused (403) |
| POST | `/v1/projects/:name/restart` | `{ service? }` | `ProjectStatus` |
| POST | `/v1/projects/:name/exec` | `{ service, argv: string[], timeoutMs? }` | `{ ok, mode, output, truncated }` — argv, never a shell string built by octopod; output bounded; a failure says how it ended (exit code, timeout). `mode: "run"` when the service was not running (stopped, restarting in a loop): the command ran in a one-off container of it (same image, mounts, user, network), kept out of the edge's routes |
| GET | `/v1/projects/:name/logs?service=&tail=` | | `{ lines: string[] }` |
| GET | `/v1/projects/:name/info?service=&instance=` | | `{ service, ok, text }` — what the service's `info` action reads in it, the project's secrets and the passwords of URLs replaced by `‹secret›` |
| GET | `/v1/projects/:name/actions?instance=` | | `{ service, action, summary?, input, tty, confirm? }[]` |
| POST | `/v1/projects/:name/run` | `{ service, action, input?, output?, confirm?, instance? }` | `{ ok, code, stderr }` — `input` and `output` are absolute paths: the action reads the one, writes the other (created `0600`), streamed. An interactive action is refused; one that destroys needs `confirm: true`. Refused through the console's relay, like every POST |
| GET | `/v1/projects/:name/programs?instance=` | | `{ service, program, state, detail }[]` — every program of the running supervised services, the recipe's and the project's, as supervisord reports them (`RUNNING`, `STOPPED`, `BACKOFF`, `FATAL`, `EXITED`…) |
| POST | `/v1/projects/:name/program` | `{ service, program, action: "start" \| "stop" \| "restart", instance? }`, or `{ service, action: "reload" }` | the service's programs, after the action |
| GET | `/v1/recipes/:id/icon?project=` | | the recipe's icon, an SVG served as an image (`sandbox` policy: no script runs from it); a plain one for a recipe without |
| GET | `/v1/projects/:name/secrets?instance=` | | `{ values: string[] }` — the secrets octopod generated for the project's recipes, every running instance's unless one is named: for a client to mask them. Refused (403) through the console's relay |
| GET | `/v1/recipes?root=` | | `{ recipes: {id,title,summary,dir,digest}[], shadowed: {id,dir,by}[] }` |
| POST | `/v1/plan` | `{ root, instance? }` | `{ project, text, services, compose }` — writes nothing |
| DELETE | `/v1/projects/:name` | | `{}` (brought down first) |
| GET | `/` · `/console.js` · `/console.css` | | the console's page and files |
| POST | `/v1/console/code` | | `{ code, expires }` — a code that enrolls one browser in the console, `XXXX-XXXX`, valid 10 minutes, once. Socket only: refused through the relay |
| DELETE | `/v1/console/sessions` | | `{ closed }` — every browser signed out, every waiting code void. Socket only |
| POST | `/v1/console/enroll` | `{ code }` | `{}` and the session's cookie (`octopod_console`, `HttpOnly`, `SameSite=Strict`, 30 days); `403` for a wrong or expired code. Through the relay only |
| POST | `/v1/console/signout` | | `{}`, the session closed and its cookie removed. Through the relay only |
| GET | `/v1/lost` | | `404`, HTML for a browser, text otherwise: no route for the name in `X-Octopod-Lost`, or where that old name of a project is now. Needs no enrollment |

**The console's enrollment.** The relay sets `X-Octopod-Via: console` on everything it
passes, replacing whatever a request brought. To such a request, the API answers only
`enroll` and `signout` without a session; anything else gets
`401 { error, enroll: true }` until the browser's cookie carries a session, which a code
from `POST /v1/console/code` (`octopod console code`) opens. After 5 wrong codes in a row,
the waiting ones are void. The state directory's `console-access.json` (`0600`) keeps
digests of the codes and sessions, never the values. Clients of the socket never enroll.

```ts
interface Project {
  name: string; root: string; compose: string[];
  routes: { service: string; url: string; port?: number; portSource?: 'declared' | 'compose' | 'image' | 'guess' }[];
  problem?: string;         // in a list: why this project cannot be read; the others are listed anyway
  group?: string; tags?: string[];
}
interface ProjectStatus extends Project {
  instance?: number;        // this status is of instance N
  instances?: number[];     // the project's other instances up (on instance 1's status)
  services: { service: string; state: string; health?: string;
    programs?: { program: string; state: string; detail: string }[] }[];  // programs: a running supervised service's
  warnings?: string[];
}
```

The CLI speaks the same operations and prints the same JSON with `--json`:
`octopod edge up|down|status`, `octopod console code|revoke`, `octopod register [dir]`, `octopod up|down|status|logs|restart
[project]`, `octopod exec <project> <service> -- <command…>`, `octopod unregister <project>`,
`octopod recipes [dir] [--check]`, `octopod ps [project]` (the programs),
`octopod run [project] <service> [<action> [file]] [--yes]`,
`octopod program start|stop|restart [project] <service>/<program>`,
`octopod program reload [project] <service>` —
`up`, `down`, `status`, `logs`, `restart` and `exec` take `--instance N`;
`octopod shell [project] [service] [--instance N] [--root] [--oneshot] [-- command…]` (a
shell in a running service, as its user — or root — in its working directory; bash when
the image has it; `--oneshot` for a service that is not running; CLI only: it needs a
terminal), `octopod mcp` (an MCP server on stdio: see below), `octopod setup [--no-service] [--no-edge] [--gnome-extension] [--mcp]` (`--mcp`: `octopod mcp` registered with Claude Code at user scope; Docker checked, the API as a
systemd user service, the edge started; with `--gnome-extension`, the GNOME Shell extension
installed in the user's extensions folder — a view of the edge and the projects that reads
the API on its socket and runs the CLI, enabled the first time, refreshed after), `octopod serve [--socket path]` (the API, and the console's data; under a supervisor —
systemd, which sets `INVOCATION_ID`, or the Windows tray, `OCTOPOD_SUPERVISED` — it exits
with code 75 once octopod's code, version or built-in recipes changed on disk and held still
for 3 s, and is started again onto the new code; run by hand, it only says to restart it; `setup.sh` installs it
as the `octopod` systemd user service; on Windows the tray runs it). `OCTOPOD_STATE_DIR`, `OCTOPOD_INSTANCE` and `OCTOPOD_PORTS` select
another instance (tests, a second edge).

## The MCP server

`octopod mcp` serves the operations a coding agent needs as MCP tools, over stdio, in the
same process as the CLI. The project is the one declared in the server's working folder or
above it, or the one a tool's `project` names; `instance` picks instance N. The tools, their
names and parameters part of the contract (feature `mcp`):

| Tool | Parameters | What it does |
|---|---|---|
| `octopod_status` | `project?`, `instance?`, `all?` | `{ edge, project }` (`ProjectStatus`, plus `up: "still running"` while an up goes on), or `{ edge, projects }` with `all` |
| `octopod_logs` | `project?`, `instance?`, `service?`, `tail?` (≤ 2000), `match?` | the last lines, those containing `match` (any case), bounded |
| `octopod_plan` | `project?`, `instance?` | what `up` would run, as `octopod plan` says it |
| `octopod_exec` | `project?`, `instance?`, `service`, `argv: string[]`, `timeoutMs?` | as `POST …/exec`, output bounded to 64 KiB |
| `octopod_run` | `project?`, `instance?`, `service`, `action`, `input?`, `output?`, `confirm?` | as `POST …/run`: files by absolute path; without `output`, the output returned, bounded; an action with `confirm` in its recipe needs `confirm: true` |
| `octopod_up` | `project?`, `instance?` | registers the folder's project if needed, then up; past 60 s it answers that the up is still running, and it goes on |
| `octopod_down` | `project?`, `instance?`, `volumes?`, `confirm?` | `volumes: true` needs `confirm: true` |
| `octopod_restart` | `project?`, `instance?`, `service` | one service |
| `octopod_oidc_session` | `project?`, `instance?`, `user?`, `claims?`, `issuer?`, `url`, `link?` | `{ cookie, cookies, landed }`: the app signed in as the user, from `url`, its sign-in; with `link`, `{ url, expires_in }` for a browser |
| `octopod_oidc_token` | `project?`, `instance?`, `user?`, `claims?`, `issuer?`, `client?` | the provider's signed `id_token` and `access_token` for the user |

A tool's failure is a result with `isError`, its message said for the agent. Not offered:
secrets, a shell, register and unregister, the edge.

## Schemas

`schema/octopod.schema.json` and `schema/recipe.schema.json` (in the repository and the npm
package) are JSON Schemas of `octopod.yaml` and `recipe.yaml`, generated from the schemas
octopod checks them with: for an editor. Both files are strict: a key octopod does not know
is refused, and the refusal says a newer octopod may know it, with this one's version.

## What clients rely on

A client — a tool built on octopod — checks `octopod version --json` (or `GET /v1/version`)
and refuses to run below the version it needs. What it may rely on, from 0.1.0:

- **Features.** From 0.2.0, `version --json` lists `features`: what this octopod adds to
  contract 1. An older octopod speaks contract 1 without them, and has no `features`
  field — none. Check for the feature you use, not for a version number:
  - `secrets` (0.2.0): `octopod secrets <project> [--instance N] --json` → `{ values }`.
  - `mcp` (0.7.0): `octopod mcp`, the MCP server and its tools.
- **The CLI, with `--json`**: `version`, `register <dir>`, `plan <dir>`, `recipes`,
  `up <project>`, `status <project>`, `restart <project> --service <s>`,
  `exec <project> <service> --timeout <ms> -- <argv…>` (its answer's `mode` included),
  `logs <project> --service <s> --tail <n>`, `unregister <project>`, `edge status`,
  `edge down`; each takes `--instance N` where the table above says so. `doctor --json`
  (`{ checks: [{ name, ok, detail, fix? }] }`, exit 1 on a problem).
- **The variables** `OCTOPOD_STATE_DIR`, `OCTOPOD_INSTANCE` and `OCTOPOD_PORTS`.
- **The recipe `node-app`**, and the convention that an app's recipe has an id ending in
  `-app`.
- **In `octopod.yaml`**: `project`, `compose`, `services` (`<name>: { recipe, … }`) and
  `workspace`.

While octopod is 0.x, a change to any of these is released in a new minor version, with
a **Breaking** entry in the changelog that says what to do.

