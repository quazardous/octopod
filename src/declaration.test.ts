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

  it('leaves the port to find when none is declared', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - service: web\n');
    expect((await loadDeclaration(root)).expose).toEqual([{ service: 'web', host: 'my-app.localhost' }]);
  });

  it('refuses a project name that is not a DNS label', async () => {
    await writeFile(join(root, 'octopod.yaml'), 'project: Not_OK\nexpose:\n  - {service: web, port: 1}\n');
    await expect(loadDeclaration(root)).rejects.toThrow(/DNS label/);
  });
});
