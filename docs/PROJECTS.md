# Your project: `octopod.yaml`

A project is a folder with an `octopod.yaml`. octopod reads it, adds what a shared edge
needs, and runs the project with `docker compose`; nothing else is written into the
project but `.octopod/`, which is git-ignored. The full reference, field by field, is
[CONTRACT.md](./CONTRACT.md).

## With a compose file

Next to your compose file, say what to expose:

```yaml
project: demo            # optional: the folder's name by default
group: shop              # optional: the console groups projects by it (and tags: [php, legacy])
expose:
  - service: web         # → http://demo.octopod.localhost
  - service: api
    host: api            # → http://api.demo.octopod.localhost
    port: 8080           # optional: found in the compose file or the image otherwise
```

octopod generates the routing labels and the project's edge network in an override kept in
its own state directory; your compose file still runs with `docker compose` alone. A host
is always the project's name or a name under it: a project cannot take another's.

## With recipes, and no compose file

```yaml
services:
  app: { recipe: node-app }   # npm run dev, at http://<project>.octopod.localhost
  db:  { recipe: postgres }   # its URL handed to the app as DATABASE_URL
```

What each recipe does, and how to write your own: [RECIPES.md](./RECIPES.md). Both kinds
mix: a project's compose file is layered after its recipes, and overrides anything they
decide.

## Data

Each named volume of the project is bound to `.octopod/data/<volume>`, created as you, and
kept with the project: `docker volume prune` does not touch it, and `octopod down --volumes`
only removes Docker's pointers to it. A service that runs or writes there as root is
reported by `octopod status`.

## A shell, a home, a prompt

`octopod shell [service]` opens a shell in a service as its user, in its working directory
(`--root` as root, without sudo in the image; `-- command…` to run one). With `home: true`
on a recipe service, its user keeps its home (history, caches) in `.octopod/home/`; with
`workdir: /shop`, the project is mounted where it has always been. The prompt says
`shop@shop:app`.

## Instances

`octopod up --instance 2` runs the same folder a second time, as `demo-2`: its own
containers, network, data (`.octopod/data/2/`) and hosts (`demo-2.octopod.localhost`). The console
shows a project's instances as one stacked tile. A compose file that fixes a
`container_name` or a host port cannot run twice; `up` says which.

## Groups and tags

`group:` puts projects together: the console folds them, `octopod list --group shop` lists
them, and a group's projects can share servers ([SHARING.md](./SHARING.md)). `tags:` are free
labels, for `octopod list --tag php` and the console's filter.

## Addresses

Everything octopod serves is under `octopod.localhost`, which is the console itself:

| What | Address |
|---|---|
| a project's app, its other services | `shop.octopod.localhost`, `pma.shop.octopod.localhost` |
| the same in a group | `shop.group-m2m.octopod.localhost`, `pma.shop.group-m2m.octopod.localhost` |
| a group's shared services | `pma.group-m2m.octopod.localhost` |
| the machine's pool (shared, no group) | `pma.octopod.localhost` |
| Traefik's dashboard | `traefik.octopod.localhost` |

A project's services are all under its own name, one domain per project. A project without a
group may not be named `octopod`, `traefik`, `api`, `console`, `group-…`, nor like a shared
service's address (`pma`, `mail`, `id`, `mongo`, `redis`): they sit at the same level.

## Projects that talk to each other

Projects are isolated: each has its own network, and its routes answer only the host and
its own containers. Two projects that must reach each other share a network in their own
compose files: [PATTERNS.md](./PATTERNS.md#a-service-shared-between-projects).

## In your editor

`octopod.yaml` has a JSON Schema: a first line
`# yaml-language-server: $schema=https://raw.githubusercontent.com/quazardous/octopod/main/schema/octopod.schema.json`
gives completion and checks (`schema/recipe.schema.json` for a recipe; both are in the npm
package too). A key octopod does not know is refused, and the message says when a newer
octopod may know it.
