# octopod

[![npm](https://img.shields.io/npm/v/@quazardous/octopod)](https://www.npmjs.com/package/@quazardous/octopod)
[![CI](https://github.com/quazardous/octopod/actions/workflows/ci.yml/badge.svg)](https://github.com/quazardous/octopod/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/quazardous/octopod)](./LICENSE)
[![Node](https://img.shields.io/node/v/@quazardous/octopod)](https://nodejs.org)

> One local edge for all your Docker projects: a shared Traefik, declared projects and isolated networks — behind a small API.

On a development machine, every Docker project grows its own Traefik, its own labels, its
own ports. They fight over port 80, one Traefik adopts another project's routes, and each
project repeats the same traps in its own compose file. octopod does that part once, for
the whole machine.

- **One edge for every project.** A single Traefik on loopback serves each project at
  `http://<project>.localhost` (and `http://<name>.<project>.localhost`). No DNS, no
  `/etc/hosts`, no certificates: `*.localhost` resolves to your machine, and browsers treat
  it as a secure context.
- **Projects stay plain.** A project keeps its own compose file and adds a small
  `octopod.yaml` that says what to expose. octopod generates the labels, the routes and the
  networks. No Traefik label is written by hand.
- **Projects are isolated.** Each has its own internal edge network: Traefik reaches every
  project, and projects cannot reach each other.
- **A container you can walk into.** `octopod shell` opens a shell in a service, as its
  user, in its working directory, or as root without sudo in the image.
- **A console.** `http://octopod.localhost` shows every project, the state of its services,
  their URLs and their logs.
- **Data in the project, nothing owned by root.** Named volumes are kept in the project's
  `.octopod/data`, created as you. A service that runs or writes there as root is reported.
- **Or no compose file at all.** A project can name recipes instead: apps (`node-app`,
  `php-app`), databases (`postgres`, `mariadb`, `mongodb`), `redis`, `memcached`,
  `mailpit`, admins (`phpmyadmin`, `mongo-express`) and tools (`php-cli`), each handing
  its address to the apps.

octopod is only infrastructure: Traefik and Docker composition. It knows nothing about
what runs in your containers, and adds no variable to the services of your own compose
files. Recipes are the one place where variables are passed: a recipe you chose hands its
address to another (`DATABASE_URL` from `postgres` to `node-app`).

## Why not…

- **ddev, Lando, Laravel Valet?** They manage the stack: the language runtime, the
  database, the tools, in their own format. octopod manages the edge — routing, networks,
  where the data lives — and leaves your compose files as they are: they still run with
  `docker compose` alone (the data octopod kept in `.octopod/data` stays where it is).
- **A Traefik you set up yourself?** That is what octopod runs, with what each project
  would otherwise write by hand: the labels, a network per project so projects cannot
  reach each other, a filter on an exact label so another Traefik's containers are never
  adopted, the data kept in the project, and a console.

## Quick start

You need Linux, Docker with Compose v2 (`docker compose`), and Node.js 22 or later.

```sh
npm i -g @quazardous/octopod
octopod setup      # checks Docker, runs the API as a user service, starts the edge
```

Or from a clone: `git clone https://github.com/quazardous/octopod && cd octopod && ./setup.sh`.
On Windows, with Docker Desktop running, `.\setup.ps1` in PowerShell does the same, and puts
octopod in the notification area: its menu lists the projects and their URLs, starts or
stops them and the edge, and opens the console, whose API the tray runs. What to install
first (WSL 2, Docker Desktop) and what differs from Linux: [docs/WINDOWS.md](./docs/WINDOWS.md). Under GNOME,
`setup.sh` puts the same in the top bar: a GNOME Shell extension (`octopod setup
--gnome-extension`; it shows after you log out and in again).

Then try an example:

```sh
cd examples/whoami       # in a clone, or copy the folder
octopod up               # registers the project the first time
```

Open `http://whoami.localhost` and `http://api.whoami.localhost`, then
`http://octopod.localhost` for the console. If port 80 was taken, the edge is on 8480, and
the URLs carry `:8480`: `octopod edge status` gives them.

## Your project

Next to your compose file, an `octopod.yaml`:

```yaml
project: demo            # optional: the folder's name by default
group: shop              # optional: the console groups projects by it (and tags: [php, legacy])
expose:
  - service: web         # → http://demo.localhost
  - service: api
    host: api            # → http://api.demo.localhost
    port: 8080           # optional: found in the compose file or the image otherwise
```

Or no compose file at all, only recipes:

```yaml
services:
  app: { recipe: node-app }   # npm run dev, at http://<project>.localhost
  db:  { recipe: postgres }   # its URL handed to the app as DATABASE_URL
```

The app's user keeps its home (history, caches) with `home: true`, and the project can be
mounted where it has always been (`workdir: /shop`); the shell's prompt says
`shop@shop:app`.

A PHP stack, each service's address handed to the app (`DATABASE_URL`, `REDIS_URL`,
`MAILER_DSN`), the admins at `pma.` and `mail.<project>.localhost`:

```yaml
services:
  app:   { recipe: php-app, php: "8.3", extensions: [intl, pdo_mysql, redis] }
  db:    { recipe: mariadb, version: "10.11" }
  cache: { recipe: redis }
  mail:  { recipe: mailpit }
  pma:   { recipe: phpmyadmin }
```

The app's image gets a user named after the project, at your uid, and nothing installed in
it: its dependencies are the project's (`octopod shell -- npm install`). The user is the
image's own, renamed and moved to your uid when the image is built — `node-app` starts from
`node:22-bookworm-slim` for that reason: alpine images have no `usermod`. `octopod plan`
shows what `up` would run, and `octopod recipes` lists the recipes. You can add your own
recipe folders with `OCTOPOD_RECIPES`, `recipes:` in `octopod.yaml`, or the project's
`.octopod/recipes/`; `octopod recipes --check` reads their Dockerfiles against octopod's rules.

A PHP app's workers run beside it, supervised, and never take the container down with them:

```yaml
services:
  app:
    recipe: php-app
    programs:
      worker: { command: php bin/console messenger:consume async }
      seed:   { command: php bin/console app:seed, autostart: false }   # octopod program start app/seed
```

The project's tools run on demand, never kept up:

```yaml
  cli: { recipe: php-cli, php: "8.3" }   # octopod shell cli -- vendor/bin/phpstan analyse
```

`octopod ps` shows the programs. A project that already keeps its programs as supervisord files
mounts their folder instead (`supervisor_d: docker/supervisor`), and `octopod program
reload app` applies a change to them.

See [`examples/`](./examples) for both kinds.

## Commands

```sh
octopod up                    # start the edge if needed, then the project (registered the first time)
octopod register [dir]        # declare a project without starting it
octopod status                # its services, URLs and warnings
octopod list --group shop     # the registered projects (--tag php, too)
octopod logs --service web --tail 100
octopod shell [service]       # a shell in a service, as its user; --root; -- command…
octopod run db dump > dump.sql   # a service's actions: shell, dump, load, reset for a database
octopod ps                    # the programs of its supervised services
octopod program start app/seed
octopod restart [--service s]
octopod down                  # --volumes removes Docker's volume objects; the data stays
octopod up --instance 2       # the same project a second time, at demo-2.localhost
octopod unregister <project>
octopod edge status           # the edge, the console and the dashboard's addresses
octopod version
```

Commands run in a project's folder act on that project; elsewhere, name it
(`octopod status demo`). All but `shell` take `--json`. The same operations are an HTTP API on a unix
socket (`octopod serve`), for other tools: see [docs/CONTRACT.md](./docs/CONTRACT.md).

## The console

![The console: two projects, their services, states and routes](docs/console.png)

`http://octopod.localhost` shows every project as a tile — its state, the services
running, its warnings and URLs — grouped by `group`. A project's page has the state and
health of each service and its programs, every instance, what octopod warns about, and
the logs, which it refreshes. It is
read-only, and links to Traefik's dashboard at `http://traefik.localhost`. Both answer only
from your machine, never from a project's container. The console reads the API, which
`octopod setup` runs as the `octopod` systemd user service.

## How it works

- **The edge** is one Traefik container, published on `127.0.0.1:80` (or 8480). It reads
  the Docker socket read-only, and only considers containers carrying its own label, so
  other Traefiks on the machine and their containers are left alone.
- **`octopod up`** runs `docker compose` with your files plus a generated override that
  adds, to each exposed service, the routing labels and the project's edge network. The
  override lives in octopod's state directory, not in your project.
- **Data**: each named volume of the project is bound to `.octopod/data/<volume>`, which
  is git-ignored. The data is deleted with the project, not with a `docker volume prune`.

The lessons behind these choices are in [docs/PATTERNS.md](./docs/PATTERNS.md).

## Status

0.3 is a preview. It is tested on Linux with Docker, and runs on Windows with Docker
Desktop; macOS and rootless Docker are not tested yet. Until 1.0, the contract may change
between minor versions; every change is in the [changelog](./CHANGELOG.md), and a breaking one says what
to do. The plan is in [docs/ROADMAP.md](./docs/ROADMAP.md).

## Contributing, security, license

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · MIT, see
[LICENSE](./LICENSE).
