# Recipes

A recipe is a service ready to name in `octopod.yaml`: an image built for your project (its
user at your uid, nothing of the project inside), its settings, and what it hands to the
other services. `octopod recipes` lists them; `octopod plan` shows what `up` would run,
before anything does.

## The built-in recipes

| Recipe | What it is | It hands the apps |
|---|---|---|
| `node-app` | `npm run dev` with `HOST` and `PORT` set | — |
| `php-app` | php-fpm and nginx under supervisord; `php`, `extensions`, `docroot` | — |
| `python-app` | supervisord running the project's programs; uv; `python`, `drivers: [mysql]` | — |
| `php-cli` | a tool, run on demand (phpstan, a formatter) | — |
| `postgres` | PostgreSQL 16 | `DATABASE_URL` |
| `mariadb` | MariaDB, `version` among the LTS | `DATABASE_URL` (and `mysql` for an admin) |
| `mongodb` | MongoDB | `MONGODB_URL` |
| `redis`, `valkey` | a cache | `REDIS_URL` |
| `memcached` | a cache | `MEMCACHED_URL` |
| `mailpit` | catches the mail sent, read at `mail.<project>.octopod.localhost` | `MAILER_DSN`, `SMTP_URL` |
| `oidc` | an OpenID Connect provider ([OIDC.md](./OIDC.md)) | `OIDC_ISSUER_BASE` |
| `phpmyadmin`, `mongo-express` | the admin of the database, signed in | — |
| `redis-commander` | a viewer of the Redis or Valkey: keys, values, a command line, at `redis.<project>.octopod.localhost`; comes with `redis` and `valkey` unasked | — |

The apps (`node-app`, `php-app`, `python-app`) take each of these when the project has one:
a recipe that provides `sql` hands its URL to every app that wants one.

## A PHP stack

```yaml
services:
  app:   { recipe: php-app, php: "8.3", extensions: [intl, pdo_mysql, redis] }
  db:    { recipe: mariadb, version: "10.11" }
  cache: { recipe: redis }
  mail:  { recipe: mailpit }
  pma:   { recipe: phpmyadmin }
  cli:   { recipe: php-cli, php: "8.3" }   # octopod shell cli -- vendor/bin/phpstan analyse
```

The app's image gets a user named after the project, at your uid, and nothing installed in
it: its dependencies are the project's (`octopod shell -- composer install`). The user is the
image's own, renamed and moved to your uid when the image is built: `node-app` starts from
`node:22-bookworm-slim` for that reason, alpine images having no `usermod`.

## Programs: workers that never take the container down

An app recipe runs supervisord: the app's workers run beside it, and a worker that dies is
started again without the container going with it.

```yaml
services:
  app:
    recipe: php-app
    programs:
      worker: { command: php bin/console messenger:consume async }
      seed:   { command: php bin/console app:seed, autostart: false }   # octopod program start app/seed
```

`octopod ps` shows the programs. A project that already keeps its programs as supervisord
files mounts their folder instead (`supervisor_d: docker/supervisor`), and `octopod program
reload app` applies a change to them.

## Actions: what your Makefiles repeat

A database recipe names its actions: `octopod run db shell`, `octopod run db dump >
dump.sql`, `octopod run db load dump.sql`, `octopod run db reset`. The destructive ones ask
for a confirmation (`--yes`). A project adds its own (`actions:` on a service).

An app recipe has an `info` action: `octopod run app info` says what runs in it, like a
phpinfo — for `python-app` its Python, its venv, `sys.path`, its packages, its environment
(what looks like a secret hidden) and its programs; for `php-app` the real `php -i`; for
`node-app` its versions and `npm ls`. In the console, the app's icon opens it.

## A driver that compiles

A Django app on MariaDB names the driver it compiles (mysqlclient has no Linux wheel):
`app: { recipe: python-app, drivers: [mysql] }` adds a compiler and the MariaDB client's
headers to the image, and `octopod shell -- uv sync` builds it.

## Your own recipes

A recipe is a folder with a `recipe.yaml` and, when it builds, a `Dockerfile`. octopod looks
in its own, then in `OCTOPOD_RECIPES` (a PATH-like list), then in the folders a project names
(`recipes:` in `octopod.yaml`), then in the project's `.octopod/recipes/`: the closest wins,
and `octopod recipes` says which one hides which. `octopod recipes --check` reads their
Dockerfiles against octopod's rules: the final stage starts `FROM ${BASE_IMAGE}`, nothing is
copied from a build context (it is the Dockerfile alone), no `VOLUME`, no project
dependency installed in the image, the last `USER` not root. The format, field by field:
[CONTRACT.md](./CONTRACT.md) and its JSON Schema, `schema/recipe.schema.json`.

A recipe from a third party builds an image on your machine: review it like code, as
[SECURITY.md](../SECURITY.md) says.
