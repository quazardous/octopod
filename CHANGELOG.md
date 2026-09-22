# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
