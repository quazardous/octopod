/**
 * What a project takes on disk, and emptying what may be lost. Sizes are read from the
 * files themselves (no `du`: it is not on every machine octopod runs on).
 */
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The bytes under a path, links not followed, folders named in `skip` left out; 0 when it is not there. */
export async function sizeOf(path: string, skip: string[] = []): Promise<number> {
  const stats = await lstat(path).catch(() => undefined);
  if (!stats) return 0;
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of await readdir(path).catch(() => [])) if (!skip.includes(entry)) total += await sizeOf(join(path, entry), skip);
  return total;
}

/** What a folder held, removed; the folder itself kept, a mount point a container still uses. */
export async function empty(path: string): Promise<number> {
  const size = await sizeOf(path);
  for (const entry of await readdir(path).catch(() => [])) await rm(join(path, entry), { recursive: true, force: true });
  return size;
}

/** A size for a person: 1.2 GB, 340 MB, 12 kB. */
export function humanSize(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${unit === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

/** Docker's sizes (`500MB`, `1.2GB`, `14.42kB`), in bytes. */
export function dockerBytes(text: string): number {
  const m = /^([\d.]+)\s*([kMGT]?B)$/i.exec(text.trim());
  if (!m) return 0;
  const scale: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
  return Math.round(Number(m[1]) * (scale[m[2]!.toLowerCase()] ?? 1));
}
