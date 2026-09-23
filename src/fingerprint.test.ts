import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, selfWatch, supervised } from './fingerprint.js';

describe("what octopod serve runs, as a fingerprint", () => {
  let root: string;
  const touch = async (path: string, seconds: number): Promise<void> => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), 'x');
    await utimes(join(root, path), seconds, seconds);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'octopod-fp-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await touch('src/cli.ts', 1000);
    await touch('recipes/node-app/recipe.yaml', 1000);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('moves with the code, the built-in recipes and the version — not with tests, the console or a project', async () => {
    const start = await fingerprint(root);
    await touch('src/cli.test.ts', 5000);
    await touch('console/console.js', 5000);
    await touch('.octopod/recipes/mine/recipe.yaml', 5000);
    expect(await fingerprint(root)).toBe(start);

    await touch('recipes/node-app/recipe.yaml', 2000);
    const recipes = await fingerprint(root);
    expect(recipes).not.toBe(start);
    await touch('dist/cli.js', 3000);
    const built = await fingerprint(root);
    expect(built).not.toBe(recipes);
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.0.1' }));
    expect(await fingerprint(root)).not.toBe(built);
  });
});

describe('the service watching itself', () => {
  let current: string;
  let clock: number;
  let lines: string[];
  let restarts: number;
  const watch = (isSupervised: boolean) =>
    selfWatch({
      initial: 'a',
      fingerprint: async () => current,
      now: () => clock,
      quietMs: 3000,
      supervised: isSupervised,
      log: (l) => lines.push(l),
      restart: () => restarts++,
    });

  beforeEach(() => {
    current = 'a';
    clock = 0;
    lines = [];
    restarts = 0;
  });

  it('restarts once octopod changed and held still, and only then', async () => {
    const w = watch(true);
    await w.tick();
    expect(w.changed()).toBe(false);
    current = 'b';
    await w.tick();
    expect(w.changed()).toBe(true);
    clock = 2000;
    current = 'c'; // a pull still writing
    await w.tick();
    clock = 4000;
    await w.tick();
    expect(restarts).toBe(0);
    clock = 5500;
    await w.tick();
    expect(restarts).toBe(1);
    clock = 20000;
    await w.tick();
    expect(restarts).toBe(1);
    expect(lines).toEqual(['octopod changed on disk: restarting onto the new code']);
  });

  it('only says so when nothing would bring it back', async () => {
    const w = watch(false);
    current = 'b';
    await w.tick();
    clock = 5000;
    await w.tick();
    await w.tick();
    expect(restarts).toBe(0);
    expect(lines).toEqual(['octopod changed on disk: restart `octopod serve` to run the new code']);
  });

  it('knows its supervisors: systemd, the Windows tray', () => {
    expect(supervised({ INVOCATION_ID: 'x' })).toBe(true);
    expect(supervised({ OCTOPOD_SUPERVISED: '1' })).toBe(true);
    expect(supervised({})).toBe(false);
  });
});
