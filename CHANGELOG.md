# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- [docs/WINDOWS.md](docs/WINDOWS.md): octopod on Windows — WSL 2 and Docker Desktop, npm or a clone, the tray, and what differs from Linux: files changed on Windows raise no event in a container (a watcher must poll), `*.localhost` resolves in browsers and `curl` only, line endings, port 80.

## [0.3.2] - 2026-09-23

### Added

- Linux: a GNOME Shell extension, the Windows tray's counterpart — the tako in the top bar, red while the edge runs, grey and asleep when it does not, Docker does not answer or octopod's service does not. Its menu lists the projects with their state and URLs, starts and stops them (`octopod up`/`down`) and the edge, opens a project's folder, the console, Traefik's dashboard and GitHub. It reads the API on its socket and runs the CLI; it supervises nothing. `octopod setup --gnome-extension` installs it, and `setup.sh` does under GNOME (`--no-extension` skips it); it shows after you log out and in again. GNOME Shell 48 to 50.
- The console wears the tray's tako: as its tab's icon (`/favicon.svg`, and `/favicon.ico` for a browser that asks for it on its own) and before its name, grey and asleep when the edge is stopped or octopod does not answer.
- The console has an *Add a project* help, below the projects — the `octopod.yaml`, then `octopod up` — open by itself while there is no project, and a link to octopod's GitHub; its links carry the GitHub and Traefik logos.
- Windows: the tray's menu has *octopod on GitHub*, and its links carry the tako and the Traefik and GitHub logos.

### Changed

- The console says how fresh it is with a refresh icon that turns at each reading, grey when paused and red when octopod does not answer, the time in its tooltip, instead of "updated 4s ago".

### Fixed

- Windows: `setup.ps1` asks a running tray to quit instead of killing it, so no dead icon is left in the notification area.
- Windows: the tray kept its menu's pictures open, and a `git pull` or a new install could not replace them while it ran. It keeps copies and lets the files go.

## [0.3.1] - 2026-09-23

### Added

- Windows: a tray icon — a tako with its hachimaki, red while the edge runs, grey and asleep when it does not or Docker Desktop is off. Its menu lists the projects with their URLs, starts and stops them (`octopod up`/`down`) and the edge, opens Traefik's dashboard and a project's folder, starts Docker Desktop, and can start with Windows. It goes through the CLI; the edge is Docker's, and keeps running when the tray quits. `setup.ps1` adds it to the Start menu and starts it (`-NoTray` does neither).
- Windows: the API and the console. With no unix sockets there, `octopod serve` listens on loopback, on a port kept in `api.json`, and answers only requests that carry the token of that file (`X-Octopod-Token`); the console relay reaches it through `host.docker.internal` and adds the token. The tray runs `octopod serve`, starts it again if it ends, and has an *octopod console* entry.

### Changed

- The console shows the projects as a gallery — each at a glance: its state, services running, warnings, routes, tags — and each opens on a page of its own (`#/p/<project>`, one per instance) with its services, programs, warnings and logs. The gallery takes the whole screen, in the colours of VS Code's Light and Dark Modern themes. The header gives octopod's version.

## [0.3.0] - 2026-09-23

### Added

- Windows: `setup.ps1` sets octopod up from a clone in PowerShell — the `octopod` command on the PATH, Docker checked, the edge started. There is no user service there: the API (`octopod serve`) and the console, which reads it through a unix socket, are not available on Windows yet.
- Projects can declare a `group` and `tags` in `octopod.yaml`. The console groups projects by group and filters on `group:x` or `tag:y`; `octopod list --group x --tag y` and `GET /v1/projects?group=&tag=` list them.
- The `php-app` recipe: PHP-FPM and nginx in one container run by supervisord, the project mounted at `/app` and its docroot (`public` by default) served at `http://<project>.localhost`. The PHP version (`8.4` by default, down to `8.1`; older PHP images sit on a Debian out of support, whose packages no longer install) and the extensions (`intl`, `pdo_mysql`, `redis`…) are parameters; composer is in the image; `DATABASE_URL` comes from a database recipe. A project that needs more copies it into `.octopod/recipes/` and adapts its Dockerfile.
- A shell like a machine's: in `node-app`, `php-app` and `php-cli`, the prompt says where you are (`<user>@<project>:<service>`, red as root), with a history that lasts and `ll`/`la`; your `~/.bashrc` comes after. `home: true` on a service keeps its user's home — history, caches, tools' settings — in `.octopod/home/<service>`, or `home: <folder>` in a folder of the project. `workdir: /my-app` mounts the project there instead of `/app`.
- Actions: `octopod run db dump > dump.sql`, `octopod run db load dump.sql`, `octopod run db shell`, `octopod run db reset` — what each Makefile's db-sh, db-dump and db-load repeat. `mariadb`, `postgres` and `mongodb` have them; a recipe declares its own (`actions:`), and a project adds some per service in `octopod.yaml`. Credentials are read in the container, never on the host's command line; `load` and `reset` ask first (`--yes`). The API runs them with files: `POST /v1/projects/:name/run`, `GET /v1/projects/:name/actions`.
- Service recipes: `redis`, `memcached`, `mongodb`, `mailpit`, `phpmyadmin` and `mongo-express`. Each is reached inside the project by its service name and hands its address to the apps that require it: `php-app` and `node-app` get `REDIS_URL`, `MEMCACHED_URL`, `MONGODB_URL` and `MAILER_DSN`/`SMTP_URL` when the project has such a service, as they get `DATABASE_URL`. The admins are routed under the project (`mail.`, `pma.`, `mongo.<project>.localhost`), phpMyAdmin logged in to the project's MariaDB, mongo-express connected to its MongoDB. None runs as root; what they keep in `.octopod/data` is the operator's.
- `mariadb`, `redis` and `mongodb` take a `version` among the releases they list (`mariadb`: 11.8, 11.4, 10.11, 10.6; `redis`: 8.0, 7.4, 7.2, 6.2; `mongodb`: 8.0, 7.0, 6.0, 5.0). MariaDB also provides `mysql`, with its address and credentials, for an admin.
- Tools: a recipe with `tool: true` makes a service run on demand only — built by `up`, never started, never routed; `octopod shell <project> <tool> -- <command…>` runs it in a one-off container, and `status` shows it as a `tool`. The `php-cli` recipe is one: PHP and composer for the project's tools (phpstan, php-cs-fixer…), as the project's user, its cache kept in `.octopod/data`.
- Programs: a service made of a recipe that runs supervisord (`php-app`) takes `programs:` in `octopod.yaml` — workers started with the container and started again whenever they end, or tasks (`autostart: false`) started by hand. `octopod ps` lists them with their state, `octopod program start|stop|restart <service>/<program>` acts on one; the API has `GET /v1/projects/:name/programs` and `POST /v1/projects/:name/program`. A recipe declares its supervisor with `supervisor: { config, programs }`.
- `supervisor_d:` on a supervised service mounts a folder of the project's own supervisord files, read-only; `octopod program reload <service>` applies a change to them without recreating the container.
- `octopod status` warns about each service whose main process runs as root, read from the running process itself: what it writes in the project would be root's.
- `octopod recipes --check [dir]` reads each recipe's Dockerfile against octopod's rules — `FROM ${BASE_IMAGE}`, nothing copied from the build context, no `VOLUME`, no project dependencies, not `USER root` — and exits 1 on a problem.
- Recipe images may install system packages and language extensions; never a project's dependencies (`npm install`, `composer install`…), which stay the project's.
- Recipes can take a version: their image may name an enum param (`php:{{params.php}}-fpm`), so a project picks among the versions the recipe lists. Recipes can also pass their params to the build (`buildArgs`), never their secrets. A `set` param takes several of the values a recipe lists (`extensions: [intl, gd]`).

### Fixed

- Windows: docker got too little of octopod's environment to find its plugins, so `docker compose` was missing and `octopod setup` refused to go on. Variables are now matched whatever their case (`Path`), and the few docker needs there (`ProgramFiles`, `USERPROFILE`…) are passed.
- Windows: the console relay restarted in a loop — without an operator's uid it ran as root, and nginx could not chown its temp folders with no capability. It now runs as the image's own nginx user there.
- Windows: the console and the dashboard stayed at 404 after the edge was first started. Docker Desktop passes no file events through a bind mount, so Traefik never saw the middleware that lets the host in; the edge is restarted when that middleware changes.
- A clone on Windows (git's `core.autocrlf`) got the recipes with CRLF line endings, which heredocs and configs would carry into Linux images, and `octopod recipes --check` found "no FROM" in them. `.gitattributes` now keeps LF; the check reads a CRLF Dockerfile, as written on Windows, as well.
- `octopod unregister` without `--json` failed once it had unregistered (`p.routes is not iterable`): it now says what it did.
- Installing from the repository (`npm install github:quazardous/octopod#<tag>`) gave an `octopod` that could not start: `dist/` was not built. It is now, by a `prepare` script. npm is still the way to install a release (`npm i -g @quazardous/octopod`; `octopod` alone, without the scope, is another package).
- `octopod exec` into a service restarting in a loop falls back to a one-off container with newer Docker versions too, which say `cannot exec in a stopped state`.
- A project that cannot be read (a broken `octopod.yaml`, a recipe that does not load) no longer breaks the whole list, nor the console: it is listed with its `problem`, and the others as usual.

## [0.2.0] - 2026-09-22

### Added

- `octopod secrets <project> --json` and `GET /v1/projects/:name/secrets`: the values of the secrets octopod generated for a project's recipes, of every running instance (or of one, with `--instance`), for a client to mask them — a chat bridge, for instance, before anything leaves the machine. Without `--json`, only their names. The console's relay refuses the route: the console never needs them.
- `octopod version --json` lists `features`: what this octopod adds to contract 1 (`secrets`). A client checks for the feature it needs, since an older octopod speaks contract 1 too without it.
- On the npm registry: `npm i -g @quazardous/octopod`. A version tag publishes it from CI through npm's trusted publishing — no token anywhere, and npm records where the package came from. The package ships built (`dist/`), and the command runs it.

### Changed

- `octopod up` in a folder whose `octopod.yaml` was never registered registers it first, and says so: a freshly cloned project starts with one command. A name already registered from another folder is still refused, and `octopod up <name>` still only starts a registered project.

## [0.1.0] - 2026-09-22

The first preview: tested on Linux with Docker.

### Added

- A shared Traefik for the machine, on loopback, that only routes containers octopod labelled — including when other projects run their own Traefik next to it.
- Projects declare what to expose in `octopod.yaml`; octopod generates the labels and networks, and serves each at `http://<project>.localhost` or a host under it.
- Each project on its own edge network: projects cannot reach each other.
- `octopod` CLI and a JSON API over a unix socket: register, up, down, status, logs, edge.
- Installable without a clone, from a release's source archive: `npm i -g https://github.com/quazardous/octopod/archive/refs/tags/v0.1.0.tar.gz`, then `octopod setup` — Docker checked, the API as a systemd user service, the edge started. `setup.sh` does the same from a clone. (`npm i -g github:…` fails: npm's global install from git does not complete.)
- `octopod shell [project] [service]`: a shell in a running service, as its own user in its working directory — or as root with `--root`, with no sudo in the image; `-- command…` runs a command instead; `--oneshot` opens a fresh container of a service that is not running.
- `octopod version` (`--json`: `{ version, contract }`) and `GET /v1/version`, so a client can require a minimum version; docs/CONTRACT.md lists what clients may rely on.
- A read-only web console at `http://octopod.localhost`: every project and instance, the state of its services, their URLs, warnings and logs, with a link to Traefik's dashboard. `setup.sh` runs the API as a systemd user service for it.

### Fixed

- A service made of recipes starts once the services that provide what it requires are ready: healthy when they have a health check, started otherwise (`depends_on`). An app no longer starts before its database and fails on a refused connection. `octopod plan` shows what each service waits for.

- octopod closes the input of every docker command it runs: a question from compose (recreate a volume, a network?) gets an end of input at once, instead of hanging the command until its timeout.

- Several octopod edges on one machine (the default one, a test run, another `OCTOPOD_INSTANCE`) no longer adopt each other's containers: each only considers `octopod.edge=<its instance>`. Before, their routers of the same name collided and Traefik dropped them — the dashboard answered 404. Projects brought up before this change need `octopod up` again, to carry the new label.
- After a restart, the edge reconnects to every instance of a project, not only the first.

### Security

- Traefik's dashboard and the console answer only from the host: a project's containers, which reach the edge over their edge network, get a 403.
- `octopod` and `traefik` can no longer be project names: they are the edge's own hosts.

[Unreleased]: https://github.com/quazardous/octopod/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/quazardous/octopod/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/quazardous/octopod/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/quazardous/octopod/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/quazardous/octopod/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/quazardous/octopod/releases/tag/v0.1.0
