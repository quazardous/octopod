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

describe('the built-in recipes', () => {
  it('load, and install no dependency in an image', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    expect([...book.recipes.keys()].sort()).toEqual(['mariadb', 'node-app', 'postgres', 'whoami']);
    for (const id of await readdir(BUILTIN_RECIPES)) {
      const dockerfile = await readFile(join(BUILTIN_RECIPES, id, 'Dockerfile'), 'utf8').catch(() => '');
      expect(dockerfile.replace(/^#.*$/gm, ''), id).not.toMatch(/\b(npm (install|ci)|yarn( install)?\b|pnpm (install|i)\b|pip3? install|composer install|bundle install|apt-get install|apk add)/);
    }
  });
});

describe('rendering services', () => {
  const secrets = (bytes: number): string => `s${bytes}`;

  it('builds the app with its user named after the project at the operator\'s uid, from an empty context', async () => {
    const book = await loadRecipes([BUILTIN_RECIPES]);
    const out = renderServices({ project: 'shop', book, services: { app: { recipe: 'node-app' } }, workspace: '/home/op/shop', owner: '1234:5678', secretFactory: secrets });
    const app = out.compose.services.app;
    expect(app.image).toBeUndefined();
    expect(app.build).toEqual({ context: '.octopod/build/app', args: { BASE_IMAGE: 'node:22-bookworm-slim', UID: '1234', GID: '5678', USER_NAME: 'shop' } });
    expect(out.files['.octopod/build/app/Dockerfile']).toContain('usermod');
    expect(app.volumes).toEqual(['/home/op/shop:/app']);
    expect(app.working_dir).toBe('/app');
    expect(app.user).toBe('1234:5678');
    expect(app.expose).toEqual(['3000']);
    expect(app.profiles).toEqual(['dev']);
    expect(app.environment).toEqual({ HOST: '0.0.0.0', PORT: '3000', NODE_ENV: 'development' });
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
