# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Recipes can take a version: their image may name an enum param (`php:{{params.php}}-fpm`), so a project picks among the versions the recipe lists. Recipes can also pass their params to the build (`buildArgs`), never their secrets.

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

[Unreleased]: https://github.com/quazardous/octopod/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/quazardous/octopod/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/quazardous/octopod/releases/tag/v0.1.0
