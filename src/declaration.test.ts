import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDeclaration } from './declaration.js';

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'octopod-decl-'));
  root = join(base, 'My App');
  await mkdir(root);
  await writeFile(join(root, 'docker-compose.yml'), 'services: {}\n');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('loadDeclaration', () => {
  it('fills the defaults: project from the folder, compose file found, host from the project', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n    port: 3000\n');
    expect(await loadDeclaration(root)).toEqual({
      project: 'my-app',
      root,
      compose: [join(root, 'docker-compose.yml')],
      expose: [{ service: 'web', port: 3000, host: 'my-app.localhost' }],
    });
  });

  it('takes the project\'s own override after its main file, as compose would', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n    port: 3000\n');
    await writeFile(join(root, 'docker-compose.override.yml'), 'services: {}\n');
    expect((await loadDeclaration(root)).compose).toEqual([join(root, 'docker-compose.yml'), join(root, 'docker-compose.override.yml')]);
    // compose.yaml comes first, and brings its own override name.
    await writeFile(join(root, 'compose.yaml'), 'services: {}\n');
    await writeFile(join(root, 'compose.override.yaml'), 'services: {}\n');
    expect((await loadDeclaration(root)).compose).toEqual([join(root, 'compose.yaml'), join(root, 'compose.override.yaml')]);
  });

  it('takes exactly the declared files, adding no override', async () => {
    await writeFile(join(root, 'docker-compose.override.yml'), 'services: {}\n');
    await writeFile(join(root, 'octopod.yaml'), 'compose: [docker-compose.yml]\nexpose:\n  - service: web\n    port: 3000\n');
    expect((await loadDeclaration(root)).compose).toEqual([join(root, 'docker-compose.yml')]);
  });

  it('refuses a host outside the project, a duplicate host and an unknown key', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'project: demo\nexpose:\n  - {service: web, port: 1, host: "x y"}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/not a DNS label/);
    await writeFile(join(root, 'octopod.yaml'), 'project: demo\nexpose:\n  - {service: web, port: 1}\n  - {service: api, port: 2}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/demo.localhost is exposed twice/);
    await writeFile(join(root, 'octopod.yaml'), 'project: demo\nimage: evil\nexpose:\n  - {service: web, port: 1}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/Unrecognized key/);
  });

  it('refuses the names the edge serves itself: its console and Traefik\'s dashboard', async () => {
    for (const name of ['octopod', 'traefik']) {
      await writeFile(join(root, 'octopod.yaml'), `project: ${name}\nexpose:\n  - {service: web, port: 1}\n`);
      await expect(loadDeclaration(root)).rejects.toThrow(/edge's own name/);
    }
  });

  it('takes a group and tags, as DNS labels, tags once each', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'group: m2m\ntags: [php, legacy, php]\nexpose:\n  - {service: web, port: 1}\n');
    const d = await loadDeclaration(root);
    expect(d.group).toBe('m2m');
    expect(d.tags).toEqual(['php', 'legacy']);
    await writeFile(join(root, 'octopod.yaml'), 'group: "M2M stack"\nexpose:\n  - {service: web, port: 1}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/group: must be a DNS label/);
  });

  it('leaves the port to find when none is declared', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n');
    expect((await loadDeclaration(root)).expose).toEqual([{ service: 'web', host: 'my-app.localhost' }]);
  });

  it('takes a declared env file inside the project, and nothing outside it', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'env_file: docker-compose.env\nexpose:\n  - service: web\n');
    expect((await loadDeclaration(root)).envFile).toBe(join(root, 'docker-compose.env'));
    await writeFile(join(root, 'octopod.yaml'), 'env_file: ../elsewhere.env\nexpose:\n  - service: web\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/inside the project/);
    await writeFile(join(root, 'octopod.yaml'), 'env_file: /etc/environment\nexpose:\n  - service: web\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/inside the project/);
  });

  it('takes services made of recipes, their parameters, extra recipe folders and a workspace', async () => {
    await rm(join(root, 'docker-compose.yml'));
    await writeFile(join(root, 'octopod.yaml'), 'services:\n  app: { recipe: node-app }\n  db: { recipe: postgres, persist: false, db: shop }\nrecipes: [../shared-recipes]\nworkspace: src\n');
    const d = await loadDeclaration(root);
    expect(d.services).toEqual({ app: { recipe: 'node-app', params: {} }, db: { recipe: 'postgres', params: { persist: false, db: 'shop' } } });
    expect(d.recipeDirs).toEqual([join(base, 'shared-recipes')]);
    expect(d.workspace).toBe(join(root, 'src'));
    expect(d.compose).toEqual([]);
    expect(d.expose).toEqual([]);
  });

  it('refuses a declaration with nothing to serve', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'project: demo\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/nothing to serve/);
  });

  it('refuses a project name that is not a DNS label', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'project: Not_OK\nexpose:\n  - {service: web, port: 1}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/DNS label/);
  });
});
