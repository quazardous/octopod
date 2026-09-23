/**
 * Recipes: what the loader lets through, which folder wins a name, and what a project's
 * `services:` become — the operator's conventions included (data kept in the project,
 * the image's user at the operator's uid, nothing installed in an image, the dev profile).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_RECIPES, digestOf, loadRecipes, RecipeError } from './loader.js';
import { formatPlan, renderServices, userNameOf } from './render.js';
import { lintDockerfile } from './lint.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'octopod-recipes-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function recipe(dir: string, id: string, yaml: string, dockerfile?: string): Promise<void> {
  await mkdir(join(dir, id), { recursive: true });
  await writeFile(join(dir, id, 'recipe.yaml'), yaml);
  if (dockerfile !== undefined) await writeFile(join(dir, id, 'Dockerfile'), dockerfile);
}

const WEB = 'title: Web\nsummary: s\nimage: web:1\nunpinned: true\nport: 80\nroute: true\n';

describe('the recipe folders', () => {
  it('lets the closest folder win a name, and says which recipe it hides', async () => {
    const general = join(base, 'general');
    const close = join(base, 'close');
    await recipe(general, 'web', WEB);
    await recipe(general, 'other', WEB);
    await recipe(close, 'web', WEB.replace('web:1', 'web:2'));
    const book = await loadRecipes([general, join(base, 'missing'), close]);
    expect(book.recipes.get('web')?.recipe.image).toBe('web:2');
    expect(book.recipes.get('other')?.dir).toBe(general);
    expect(book.shadowed).toEqual([{ id: 'web', dir: general, by: close }]);
  });

  it('refuses a moving tag unless the recipe says so, and a build without its Dockerfile', async () => {
    await recipe(base, 'tagged', WEB.replace('unpinned: true\n', ''));
    await expect(loadRecipes([base])).rejects.toThrow(/moving tag/);
    await rm(join(base, 'tagged'), { recursive: true });
    await recipe(base, 'built', `${WEB}build: true\n`);
    await expect(loadRecipes([base])).rejects.toThrow(RecipeError);
  });

  it('refuses an action that would put a secret on the host\'s command line', async () => {
    await recipe(base, 'leaky', 'title: T\nsummary: s\nimage: x\nunpinned: true\nparams:\n  pw: { type: secret }\nactions:\n  shell: { command: [db, "-p{{secrets.pw}}"] }\n');
    await expect(loadRecipes([base])).rejects.toThrow(/action 'shell' names a secret/);
  });

  it('refuses a tool that would be routed', async () => {
    await recipe(base, 'routed-tool', 'title: T\nsummary: s\nimage: x\nunpinned: true\ntool: true\nroute: true\n');
    await expect(loadRecipes([base])).rejects.toThrow(/a tool is run on demand/);
  });

  it('lets an enum param choose the image\'s version, and nothing else choose it', async () => {
    const dir = join(base, 'recipes');
    const versioned = 'title: T\nsummary: s\nimage: "php:{{params.php}}-fpm"\nunpinned: true\nparams:\n  php: { type: enum, values: ["8.4", "7.4"], default: "8.4" }\n';
    await recipe(dir, 'php', versioned);
    const book = await loadRecipes([dir]);
    const render = (params?: Record<string, string>) =>
      renderServices({ project: 'shop', book, services: { app: { recipe: 'php', ...(params ? { params } : {}) } }, workspace: '/w' }).compose.services.app.image;
    expect(render()).toBe('php:8.4-fpm');
    expect(render({ php: '7.4' })).toBe('php:7.4-fpm');
    expect(() => render({ php: '5.6' })).toThrow();
    await recipe(dir, 'loose', versioned.replace('{ type: enum, values: ["8.4", "7.4"], default: "8.4" }', '{ type: ident, default: "latest" }'));
    await expect(loadRecipes([dir])).rejects.toThrow(/image may only name an enum param/);
  });

  it('passes params to the build, never a secret: a build argument stays in the image\'s history', async () => {
    const dir = join(base, 'recipes');
    const base_ = 'title: T\nsummary: s\nimage: base:1\nunpinned: true\nbuild: true\nparams:\n  docroot: { type: ident, default: public }\n  pass: { type: secret }\n';
    await recipe(dir, 'app', `${base_}buildArgs: { DOCROOT: "{{params.docroot}}" }\n`, 'FROM x\n');
    const book = await loadRecipes([dir]);
    const build = renderServices({ project: 'shop', book, services: { app: { recipe: 'app' } }, workspace: '/w', secretFactory: (n) => `s${n}` }).compose.services.app.build as { args: Record<string, string> };
    expect(build.args.DOCROOT).toBe('public');
    expect(build.args.BASE_IMAGE).toBe('base:1');
    await recipe(dir, 'leak', `${base_}buildArgs: { PASS: "{{params.pass}}" }\n`, 'FROM x\n');
    await expect(loadRecipes([dir])).rejects.toThrow(/uses the secret 'pass'/);
    await rm(join(dir, 'leak'), { recursive: true });
    await recipe(dir, 'grab', `${base_}buildArgs: { UID: "0" }\n`, 'FROM x\n');
    await expect(loadRecipes([dir])).rejects.toThrow(/build argument UID is octopod's/);
  });

  it('takes several listed values for a set param, and nothing it does not list', async () => {
    const dir = join(base, 'recipes');
    await recipe(dir, 'php', 'title: T\nsummary: s\nimage: base:1\nunpinned: true\nbuild: true\nparams:\n  extensions: { type: set, values: [intl, gd, zip], default: [intl, zip] }\nbuildArgs: { EXTENSIONS: "{{params.extensions}}" }\n', 'FROM x\n');
    const book = await loadRecipes([dir]);
    const args = (extensions?: string[]) =>
      (renderServices({ project: 'shop', book, services: { app: { recipe: 'php', ...(extensions ? { params: { extensions } } : {}) } }, workspace: '/w' }).compose.services.app.build as { args: Record<string, string> }).args.EXTENSIONS;
    expect(args()).toBe('intl zip');
    expect(args(['gd', 'gd', 'intl'])).toBe('gd intl');
    expect(() => args(['gd', 'evil; rm -rf /'])).toThrow(/takes values among intl, gd, zip/);
    await recipe(dir, 'bad', 'title: T\nsummary: s\nimage: base:1\nunpinned: true\nparams:\n  extensions: { type: set, values: [intl], default: [gd] }\n');
    await expect(loadRecipes([dir])).rejects.toThrow(/its default names a value it does not list/);
  });

  it('refuses a conditional volume whose condition is not a bool param', async () => {
    await recipe(base, 'db', `${WEB}params: { name: { type: ident } }\nvolumes: [{ name: data, path: /d, when: name }]\n`);
    await expect(loadRecipes([base])).rejects.toThrow(/must name a bool param/);
  });

  it('counts a recipe\'s Dockerfile in its digest: what is built is what is approved', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const app = book.recipes.get('node-app')!;
    expect(app.digest).toBe(digestOf(app.recipe, app.dockerfile));
    expect(app.digest).not.toBe(digestOf(app.recipe, `${app.dockerfile}\nRUN true`));
  });
});

describe('a recipe\'s Dockerfile, checked', () => {
  it('passes one that keeps to the rules: stages, heredocs, continuation lines', () => {
    const ok = [
      'ARG BASE_IMAGE',
      'FROM composer:2 AS composer',
      'FROM ${BASE_IMAGE}',
      'COPY --from=composer /usr/bin/composer /usr/local/bin/',
      'RUN apt-get update \\',
      '  # a comment in a continuation',
      ' && apt-get install -y git',
      "COPY <<'EOF' /etc/app.conf",
      'VOLUME /not-an-instruction',
      'USER root',
      'EOF',
      'USER ${USER_NAME}',
    ].join('\n');
    expect(lintDockerfile(ok)).toEqual([]);
    // Written on Windows: the same Dockerfile, CRLF.
    expect(lintDockerfile(ok.replace(/\n/g, '\r\n'))).toEqual([]);
  });

  it('names each rule broken, with its line', () => {
    const bad = ['FROM node:22', 'COPY package.json /app/', 'RUN npm ci', 'VOLUME /data', 'USER app', 'USER 0'].join('\n');
    const problems = lintDockerfile(bad);
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/^line 1: the final stage starts FROM node:22/);
    expect(problems[1]).toMatch(/^line 2: COPY package.json/);
    expect(problems[2]).toMatch(/^line 3: RUN installs a project's dependencies/);
    expect(problems[3]).toMatch(/^line 4: VOLUME/);
    expect(problems[4]).toMatch(/^line 6: the last USER is 0/);
  });
});

describe('the built-in recipes', () => {
  it('load, and install none of a project\'s dependencies in an image — system packages and extensions make the environment', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    expect([...book.recipes.keys()].sort()).toEqual(['mailpit', 'mariadb', 'memcached', 'mongo-express', 'mongodb', 'node-app', 'php-app', 'php-cli', 'phpmyadmin', 'postgres', 'redis', 'whoami']);
    for (const id of await readdir(BUILTIN_RECIPES)) {
      const dockerfile = await readFile(join(BUILTIN_RECIPES, id, 'Dockerfile'), 'utf8').catch(() => '');
      if (dockerfile) expect(lintDockerfile(dockerfile), id).toEqual([]);
    }
  });

  it('renders php-app: its version, its extensions and docroot to the build, served on 8080 as the project\'s user', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'php-app', params: { php: '8.2', extensions: ['pdo_mysql', 'gd'] } }, db: { recipe: 'mariadb' } }, workspace: '/w', owner: '1234:5678', secretFactory: (n) => `s${n}` });
    const app = out.compose.services.app as Record<string, unknown> & { build: { args: Record<string, string> } };
    expect(app.build.args).toEqual(expect.objectContaining({ BASE_IMAGE: 'php:8.2-fpm', EXTENSIONS: 'pdo_mysql gd', DOCROOT: 'public', UID: '1234', GID: '5678', USER_NAME: 'shop' }));
    expect(app.user).toBe('1234:5678');
    expect(app.expose).toEqual(['8080']);
    expect(app.volumes).toEqual(['/w:/app', './.octopod/bashrc:/etc/octopod/bashrc:ro', './.octopod/programs.shop.app.conf:/etc/octopod/programs.conf:ro']);
    expect((app.environment as Record<string, string>).DATABASE_URL).toMatch(/^mysql:\/\/app:s24@db:3306\/app$/);
    expect(app.depends_on).toEqual({ db: { condition: 'service_healthy' } });
  });

  it('runs the project\'s programs beside php-app\'s own, and a change of them recreates the container', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const render = (programs: Record<string, { command: string; autostart: boolean }>) =>
      renderServices({ project: 'shop', book, services: { app: { recipe: 'php-app', programs } }, workspace: '/w', owner: '1:1', secretFactory: (n) => `s${n}` });
    const out = render({ worker: { command: 'php bin/console messenger:consume async --time-limit=3600 %x', autostart: true }, seed: { command: 'php bin/seed', autostart: false } });
    const conf = out.files['.octopod/programs.shop.app.conf'];
    expect(conf).toContain('[program:worker]\ncommand=php bin/console messenger:consume async --time-limit=3600 %%x\ndirectory=/app\nautostart=true\nautorestart=true');
    expect(conf).toContain('[program:seed]');
    expect(conf).toContain('autostart=false\nautorestart=unexpected\nstartsecs=0');
    expect(out.services[0].programs).toEqual(['worker', 'seed']);
    expect(formatPlan('shop', out.services, '/w')).toContain('runs    worker, seed (supervised)');
    const none = render({});
    expect(none.files['.octopod/programs.shop.app.conf']).not.toContain('[program:');
    const labels = (o: typeof out) => (o.compose.services.app.labels as Record<string, string>)['octopod.programs'];
    expect(labels(out)).not.toBe(labels(none));
  });

  it('refuses programs for a recipe without a supervisor, and a name the recipe uses', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const program = { command: 'x', autostart: true };
    expect(() => renderServices({ project: 'p', book, services: { app: { recipe: 'node-app', programs: { w: program } } }, workspace: '/w' })).toThrow(/runs no supervisor/);
    expect(() => renderServices({ project: 'p', book, services: { app: { recipe: 'php-app', programs: { nginx: program } } }, workspace: '/w' })).toThrow(/is the recipe's own/);
    expect(() => renderServices({ project: 'p', book, services: { app: { recipe: 'node-app', supervisorD: '/p/sup' } }, workspace: '/w' })).toThrow(/takes no supervisor_d/);
  });

  it('wires a whole stack by capabilities: the app gets each address, the admins their database', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const services = {
      app: { recipe: 'php-app' },
      db: { recipe: 'mariadb', params: { version: '10.6' } },
      cache: { recipe: 'redis' },
      sessions: { recipe: 'memcached' },
      docs: { recipe: 'mongodb', params: { version: '5.0' } },
      mail: { recipe: 'mailpit' },
      pma: { recipe: 'phpmyadmin' },
      me: { recipe: 'mongo-express' },
    };
    const out = renderServices({ project: 'shop', book, services, workspace: '/p', owner: '1:1', secretFactory: (n) => `s${n}` });
    const env = (name: string) => out.compose.services[name].environment as Record<string, string>;
    expect(env('app')).toEqual(
      expect.objectContaining({
        DATABASE_URL: 'mysql://app:s24@db:3306/app',
        REDIS_URL: 'redis://cache:6379',
        MEMCACHED_URL: 'memcached://sessions:11211',
        MONGODB_URL: 'mongodb://app:s24@docs:27017/app?authSource=admin',
        MAILER_DSN: 'smtp://mail:1025',
      }),
    );
    expect(env('pma')).toEqual(expect.objectContaining({ PMA_HOST: 'db', PMA_PORT: '3306', PMA_USER: 'app', PMA_PASSWORD: 's24' }));
    expect(env('me').ME_CONFIG_MONGODB_URL).toBe('mongodb://app:s24@docs:27017/app?authSource=admin');
    expect((out.compose.services.db.build as { args: Record<string, string> }).args.BASE_IMAGE).toBe('mariadb:10.6');
    expect((out.compose.services.docs.build as { args: Record<string, string> }).args.BASE_IMAGE).toBe('mongo:5.0');
    // A cache keeps nothing unless asked; a database keeps its data.
    expect(out.compose.services.cache.volumes).toBeUndefined();
    expect(out.compose.services.docs.volumes).toEqual(['docs-data:/data/db']);
    const routes = Object.fromEntries(out.services.filter((x) => x.route !== undefined).map((x) => [x.name, x.route]));
    expect(routes).toEqual({ app: '', mail: 'mail', pma: 'pma', me: 'mongo' });
    expect(out.compose.services.app.depends_on).toEqual({
      db: { condition: 'service_healthy' },
      cache: { condition: 'service_healthy' },
      sessions: { condition: 'service_healthy' },
      docs: { condition: 'service_healthy' },
      mail: { condition: 'service_healthy' },
    });
  });

  it('gives a database its actions, and the project\'s own beside them', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const seed = { command: ['sh', '-c', 'echo {{service}}'], input: false, tty: false, summary: 'seeds' };
    const out = renderServices({ project: 'shop', book, services: { db: { recipe: 'mariadb', actions: { seed } } }, workspace: '/p', secretFactory: (n) => `s${n}` });
    const actions = out.services[0].actions!;
    expect(Object.keys(actions)).toEqual(['shell', 'dump', 'load', 'reset', 'seed']);
    expect(actions.seed.command).toEqual(['sh', '-c', 'echo db']);
    expect(actions.load).toEqual(expect.objectContaining({ input: true, confirm: expect.stringMatching(/replaces/) }));
    expect(actions.shell.tty).toBe(true);
    // The password is read in the container: nothing generated appears in a command.
    expect(JSON.stringify(actions)).not.toContain('s24');
    expect(formatPlan('shop', out.services, '/p')).toContain('actions shell, dump, load, reset, seed (octopod run db <action>)');
    const leaky = { command: ['x', '{{secrets.password}}'], input: false, tty: false };
    expect(() => renderServices({ project: 'shop', book, services: { db: { recipe: 'mariadb', actions: { leaky } } }, workspace: '/p' })).toThrow();
  });

  it('keeps the user\'s home where the project says, mounts the project where it says, and gives the shell its prompt', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'php-app', home: true, workdir: '/shop' } }, workspace: '/p', owner: '1:1' });
    const app = out.compose.services.app as Record<string, unknown> & { build: { args: Record<string, string> } };
    expect(app.volumes).toEqual(expect.arrayContaining(['/p:/shop', './.octopod/bashrc:/etc/octopod/bashrc:ro', './.octopod/home/app:/home/shop']));
    expect(app.working_dir).toBe('/shop');
    expect(app.build.args.WORKSPACE).toBe('/shop');
    expect(app.environment).toEqual(expect.objectContaining({ OCTOPOD_PROJECT: 'shop', OCTOPOD_SERVICE: 'app' }));
    expect(out.files['.octopod/bashrc']).toContain('PS1=');
    expect(out.files['.octopod/build/app/Dockerfile']).toContain('. /etc/octopod/bashrc');
    expect(out.services[0]).toEqual(expect.objectContaining({ workspace: '/shop', home: '.octopod/home/app' }));
    // Instance 2 keeps its own home; a folder of the project is mounted as it is.
    const second = renderServices({ project: 'shop-2', book, services: { app: { recipe: 'node-app', home: '/p/docker/home' } }, workspace: '/p', instance: 2 });
    expect(second.compose.services.app.volumes).toContain('/p/docker/home:/home/shop-2');
    const third = renderServices({ project: 'shop-2', book, services: { app: { recipe: 'node-app', home: true } }, workspace: '/p', instance: 2 });
    expect(third.compose.services.app.volumes).toContain('./.octopod/home/2/app:/home/shop-2');
    expect(() => renderServices({ project: 'p', book, services: { db: { recipe: 'postgres', home: true } }, workspace: '/p' })).toThrow(/no user's home/);
    expect(() => renderServices({ project: 'p', book, services: { db: { recipe: 'postgres', workdir: '/x' } }, workspace: '/p' })).toThrow(/takes no workdir/);
  });

  it('renders php-cli as a tool: in a profile up never activates, never restarted, its cache kept', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'php-app' }, cli: { recipe: 'php-cli', params: { php: '8.3' } } }, workspace: '/p', owner: '1:1' });
    const cli = out.compose.services.cli;
    expect(cli.profiles).toEqual(['octopod-tool']);
    expect(cli.restart).toBeUndefined();
    expect(cli.volumes).toEqual(['cli-cache:/cache', '/p:/app', './.octopod/bashrc:/etc/octopod/bashrc:ro']);
    expect(out.services.find((x) => x.name === 'cli')?.tool).toBe(true);
    expect(formatPlan('shop', out.services, '/p')).toContain('tool    never started by up: octopod shell shop cli -- <command…>');
  });

  it('mounts a supervisor_d folder read-only where php-app includes it', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'php-app', supervisorD: '/p/docker/supervisor' } }, workspace: '/p' });
    expect(out.compose.services.app.volumes).toContain('/p/docker/supervisor:/etc/octopod/supervisord.d:ro');
    expect(out.files['.octopod/build/app/Dockerfile']).toContain('files = /etc/octopod/programs.conf /etc/octopod/supervisord.d/*.conf');
    expect(formatPlan('shop', out.services, '/p')).toContain('the programs of /p/docker/supervisor');
  });
});

describe('rendering services', () => {
  const secrets = (bytes: number): string => `s${bytes}`;

  it('builds the app with its user named after the project at the operator\'s uid, from an empty context', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'node-app' } }, workspace: '/home/op/shop', owner: '1234:5678', secretFactory: secrets });
    const app = out.compose.services.app;
    expect(app.image).toBeUndefined();
    expect(app.build).toEqual({ context: '.octopod/build/app', args: { BASE_IMAGE: 'node:22-bookworm-slim', UID: '1234', GID: '5678', USER_NAME: 'shop', WORKSPACE: '/app' } });
    expect(out.files['.octopod/build/app/Dockerfile']).toContain('usermod');
    expect(app.volumes).toEqual(['/home/op/shop:/app', './.octopod/bashrc:/etc/octopod/bashrc:ro']);
    expect(app.working_dir).toBe('/app');
    expect(app.user).toBe('1234:5678');
    expect(app.expose).toEqual(['3000']);
    expect(app.profiles).toEqual(['dev']);
    expect(app.environment).toEqual({ HOST: '0.0.0.0', PORT: '3000', NODE_ENV: 'development', OCTOPOD_PROJECT: 'shop', OCTOPOD_SERVICE: 'app' });
    expect(app.networks).toBeUndefined();
  });

  it('wires a database to the app, keeps its data by default, and keeps its password across renders', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const services = { app: { recipe: 'node-app' }, db: { recipe: 'postgres' } };
    const first = renderServices({ project: 'shop', book, services, workspace: '/w', owner: '1:1', secretFactory: secrets });
    expect((first.compose.services.app.environment as Record<string, string>).DATABASE_URL).toBe('postgresql://app:s24@db:5432/app');
    expect(first.compose.services.db.volumes).toEqual(['db-data:/var/lib/postgresql/data']);
    expect(first.compose.volumes).toEqual({ 'db-data': null });
    expect(first.compose.services.db.profiles).toBeUndefined();
    const again = renderServices({ project: 'shop', book, services, workspace: '/w', owner: '1:1', secrets: { db: { password: 'kept' } }, secretFactory: secrets });
    expect((again.compose.services.app.environment as Record<string, string>).DATABASE_URL).toBe('postgresql://app:kept@db:5432/app');
  });

  it('starts the app once its database is healthy, and the plan says so', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'node-app' }, db: { recipe: 'postgres' } }, workspace: '/w', secretFactory: secrets });
    expect(out.compose.services.app.depends_on).toEqual({ db: { condition: 'service_healthy' } });
    expect(out.compose.services.db.depends_on).toBeUndefined();
    expect(formatPlan('shop', out.services, '/w')).toContain('waits   for db (healthy)');
    // Alone, the app requires nothing it would wait for: its database is optional.
    expect(renderServices({ project: 'shop', book, services: { app: { recipe: 'node-app' } }, workspace: '/w' }).compose.services.app.depends_on).toBeUndefined();
  });

  it('waits only for its provider to start when the provider has no health check', async () => {
    const dir = join(base, 'recipes');
    await recipe(dir, 'queue', 'title: Queue\nsummary: s\nimage: q:1\nunpinned: true\nprovides: [queue]\nexports: { url: "q://{{service}}" }\n');
    await recipe(dir, 'worker', 'title: Worker\nsummary: s\nimage: w:1\nunpinned: true\nrequires:\n  - capability: queue\n    env: { QUEUE_URL: "{{provider.url}}" }\n');
    const out = renderServices({ project: 'shop', book: await loadRecipes([dir]), services: { jobs: { recipe: 'worker' }, q: { recipe: 'queue' } }, workspace: '/w' });
    expect(out.compose.services.jobs.depends_on).toEqual({ q: { condition: 'service_started' } });
    expect(out.compose.services.jobs.environment).toEqual({ QUEUE_URL: 'q://q' });
  });

  it('throws a database\'s data away only when asked, and the plan says so in capitals', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { db: { recipe: 'mariadb', params: { persist: false } } }, workspace: '/w', secretFactory: secrets });
    expect(out.compose.services.db.volumes).toBeUndefined();
    expect(out.compose.volumes).toBeUndefined();
    expect(formatPlan('shop', out.services, '/w')).toContain('NOT KEPT /var/lib/mysql');
  });

  it('refuses what a project may not say: an unknown recipe or parameter, a secret, a value out of type', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const run = (services: Record<string, { recipe: string; params?: Record<string, unknown> }>) =>
      renderServices({ project: 'shop', book, services, workspace: '/w', secretFactory: secrets });
    expect(() => run({ x: { recipe: 'nope' } })).toThrow(/no recipe 'nope'/);
    expect(() => run({ db: { recipe: 'postgres', params: { image: 'evil' } } })).toThrow(/no parameter 'image'/);
    expect(() => run({ db: { recipe: 'postgres', params: { password: 'mine' } } })).toThrow(/is a secret/);
    expect(() => run({ db: { recipe: 'postgres', params: { persist: 'yes' } } })).toThrow(/true or false/);
    expect(() => run({ db: { recipe: 'postgres', params: { db: 'Bad Name' } } })).toThrow(/must match/);
    expect(() => run({ Bad: { recipe: 'whoami' } })).toThrow(/the name must match/);
  });

  it('gives the image a valid Linux user name, whatever the project is called', () => {
    expect(userNameOf('hello-site')).toBe('hello-site');
    expect(userNameOf('2048-game')).toBe('u2048-game');
    expect(userNameOf('a'.repeat(40))).toHaveLength(31);
  });
});
