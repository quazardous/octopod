import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeclaration } from './declaration.js';
import { OCTOPOD_VERSION } from './meta.js';
import { jsonSchemas } from './schemas.js';

describe('the JSON Schemas', () => {
  it('are what the zod schemas say (npm run schemas)', async () => {
    for (const [name, schema] of Object.entries(jsonSchemas())) {
      expect(JSON.parse(await readFile(new URL(`../schema/${name}`, import.meta.url), 'utf8')), name).toEqual(JSON.parse(JSON.stringify(schema)));
    }
  });

  it('describe every example', async () => {
    const examples = fileURLToPath(new URL('../examples/', import.meta.url));
    for (const entry of await readdir(examples, { withFileTypes: true })) {
      if (entry.isDirectory()) await expect(loadDeclaration(join(examples, entry.name))).resolves.toBeTruthy();
    }
  });

  it('say, of a key octopod does not know, that a newer one may', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'octopod-schema-'));
    try {
      await writeFile(join(dir, 'octopod.yaml'), 'project: demo\nfuture_key: 1\n');
      await expect(loadDeclaration(dir)).rejects.toThrow(`a newer octopod may know it: this is ${OCTOPOD_VERSION}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
