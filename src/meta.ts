import { readFileSync } from 'node:fs';

/** octopod's version, from its package.json: the same file from the sources and from dist/. */
export const OCTOPOD_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** A zod issue, said for a reader; a key it does not know may be one a newer octopod does. */
export function said(issue: { path: PropertyKey[]; message: string; code?: string }): string {
  const where = issue.path.map(String).join('.') || '(root)';
  const hint = issue.code === 'unrecognized_keys' ? ` (a newer octopod may know it: this is ${OCTOPOD_VERSION})` : '';
  return `${where}: ${issue.message}${hint}`;
}
