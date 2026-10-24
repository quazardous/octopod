# Sharing servers between projects

Ten projects, ten MariaDBs: each one starts, holds its memory, and does the same as the
others. octopod can run one server for several projects instead, each project with its own
database and its own user on it.

## Which services

```yaml
group: shop
shared: true          # the databases (mariadb, postgres, mongodb); or a list: [mariadb, mailpit, oidc]
services:
  app: { recipe: php-app }
  db:  { recipe: mariadb }     # the group's mariadb-11-4; DATABASE_URL is this project's database
  cache: { recipe: redis, shared: false }   # this one stays the project's
```

- `shared:` at the top of `octopod.yaml` names the recipes the project shares with its
  group; `true` means the databases.
- `octopod share true` (or `octopod share mariadb oidc`) makes it the machine's default,
  for every project that says nothing; `octopod share --off` turns it off, which is the
  default; `octopod share` says what is set.
- On a service, `shared: true` or `shared: false` decides for that service alone.
- A project with no `group:` shares with the machine's pool, the group `default`.

## What runs

A group's shared servers are a project of their own, `<group>-shared`, shown in the console
inside the group. They come up with the first project that uses them and go down after the
last one. Their data is kept in octopod's state directory (`<state>/groups/<group>/`): it
belongs to no one project. They answer at `<service>.group-<group>.octopod.localhost`
(`pma.group-shop.octopod.localhost`); the machine's pool, at `<service>.octopod.localhost`.

There is one server per recipe and version: `mariadb-11-4`, `mariadb-10-11`. Projects that
ask for two versions get two servers, and never meet.

## Walled off

- **Its own database, its own user.** For `mariadb` and `postgres`, each project is a
  tenant: a database and a user named after it, with its own generated password, granted on
  that database alone (postgres also refuses every other role the connection). The app's
  `DATABASE_URL` keeps its usual shape: `mysql://shop:…@db:3306/shop`.
- **Its own network.** Each project reaches the shared servers over a network of its own,
  where they answer to the project's own names for them (`db`). It reaches nothing of the
  group's other projects.
- **Shared as it is.** A recipe without tenancy is shared whole: one mailpit inbox for the
  group, one phpMyAdmin (signed in with the server's own account, not a project's), one OIDC
  provider whose issuers are paths.

## Moving to a shared server

A service that becomes shared leaves its former data where it was, in the project's
`.octopod/data/`; `up` takes its old container away, and `octopod status` says that data is
still there. octopod does not move a database's data by itself: dump it from the former
server (a copy of the project, or before switching), then `octopod run db load dump.sql`.

## Tests on the shared server

A project owns, on the group's server, the database named after it and every database whose
name starts with `<project>_` or `test_<project>`: `shop`, `shop_test`, `shop_jobs`,
`test_shop`, `test_shop_2` — as many as it makes, with nothing to declare. Its tests create, use and
drop theirs there, on the real server; another project's are out of their reach (a
project's name has no `_`: `shop_…` is never `shop-admin`'s).

- **Rails** (`<base>_test`) and **Symfony** (`_test`) fall under it as they are.
- **Django** names its test database `test_<base>`, and `test_<base>_1`, `_2`… with
  `--parallel`: the project's too, so `manage.py test` runs with nothing to change.
- **Postgres** cannot allow a database by its name: a project's role may create databases
  (it owns those it creates, and never connects to another project's), and octopod makes
  `<project>_test` for it.

## The project's database, in the group's server

The project's actions on a shared database stay the project's: `octopod run db shell`,
`dump`, `load`, `reset`, in the project's folder, act in the group's server as the project's
own user, on its own database — the others' are out of its reach. In the group's stack
(`<group>-shared`), the server's actions are its own account's.
How a recipe is shared (`tenant:` in `recipe.yaml`): [CONTRACT.md](./CONTRACT.md).
