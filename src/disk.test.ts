import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dockerBytes, empty, humanSize, sizeOf } from './disk.js';

describe('disk', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-disk-'));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('adds up a folder, and empties it while keeping it, a mount point a container uses', async () => {
    await mkdir(join(dir, 'npm', 'deep'), { recursive: true });
    await writeFile(join(dir, 'npm', 'a'), 'x'.repeat(1000));
    await writeFile(join(dir, 'npm', 'deep', 'b'), 'y'.repeat(500));
    expect(await sizeOf(join(dir, 'npm'))).toBe(1500);
    expect(await sizeOf(join(dir, 'nothing'))).toBe(0);
    expect(await empty(join(dir, 'npm'))).toBe(1500);
    expect(await readdir(join(dir, 'npm'))).toEqual([]);
  });

  it("reads Docker's sizes, and says one for a person", () => {
    expect(dockerBytes('500MB')).toBe(500_000_000);
    expect(dockerBytes('14.42GB')).toBe(14_420_000_000);
    expect(dockerBytes('0B')).toBe(0);
    expect(dockerBytes('n/a')).toBe(0);
    expect(humanSize(1_234_000_000)).toBe('1.2 GB');
    expect(humanSize(340_000_000)).toBe('340 MB');
    expect(humanSize(12)).toBe('12 B');
  });
});
