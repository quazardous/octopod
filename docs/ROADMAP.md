# Roadmap

octopod started as the environment composer of bushwhack, a bridge that lets a web-chat
model work on a local project. It became its own project because every Docker + Traefik
project on a machine needs the same thing: one edge instead of one Traefik each, isolated
networks, data kept in the project, and the good practice of a development container
made the default rather than copied from project to project.

Scope: make good Docker practice easy to adopt. Traefik and Docker composition, recipes
for the common stacks, a console to see them. Not a security layer around secrets, and no
feature for one project's particular need: such a project keeps its own compose file,
which octopod layers under its own and never takes away.

## Where it stands (0.5)

- **The edge**: one Traefik on `127.0.0.1`, projects at `http://<project>.localhost` with no
  certificate and no `/etc/hosts`, each project on its own internal network, instances of a
  project side by side (`demo-2.localhost`). A project's containers reach its own hosts at
  the browser's URLs.
- **The contract**: `octopod.yaml`, the CLI with `--json`, an HTTP API on a unix socket
  (TCP with a token on Windows), versioned with `features` a client checks
  ([CONTRACT.md](./CONTRACT.md)).
- **Recipes**: apps (`node-app`, `php-app`, `python-app`), databases, caches, `mailpit`, an
  OpenID Connect provider (`oidc`), admins, tools; wired to each other by capabilities;
  your own recipe folders beside the built-in ones.
- **The container as a light machine**: `octopod shell` as the project's user (or root),
  a home and a history that last, a prompt that says where you are, supervised programs
  that keep the container up when the app dies, database actions (`dump`, `load`, `reset`).
- **The console** at `http://octopod.localhost`: the projects, their state, up and down,
  each browser enrolled once with a code. A tray icon on Windows, a GNOME extension.

## Next

- **Migrating an existing project as it is**: its compose file, its folders and its data
  left in place, octopod and the old setup used in turn, never at once. What it shows
  missing becomes the next work.
- **`octopod mcp`**: the operations as MCP tools, for coding agents.
- **Projects kept apart at the edge**: a project's containers reach its own hosts, not
  another project's.
- **The OIDC provider's users**: accounts and their claims kept by the provider, an admin,
  accounts for a CI that signs in without a browser.
- **Editor support**: JSON Schemas for `octopod.yaml` and `recipe.yaml`.
- **1.0**: when the contract has held through these, with a deprecation rule written for it.

## Technology

TypeScript on Node 22, settled before the first release. The API decouples clients from
the implementation language; the first client, the console and the recipes are
TypeScript, web and YAML; and what octopod costs is in Docker, not in its own runtime.
Go (a single binary, Docker's own ecosystem) was weighed and set aside: a rewrite for a
packaging benefit. Should a single binary become a real need, Node's single executable
applications build one from the same code.
