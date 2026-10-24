/**
 * Which services of a project its group runs instead of it, and under which name. Pure: the
 * declaration and the machine's default in, the answer out.
 *
 * A service is shared when it says so (`shared: true`), or when its recipe is in the
 * project's `shared:` list — or, when the project names none, in the machine's
 * (`octopod share`); `shared: false` keeps it to the project. `true` as a list means the
 * databases. A project with no group shares with the machine's pool, the group `default`.
 */
import { createHash } from 'node:crypto';
import type { Declaration } from './declaration.js';

/** What `shared: true` names: the databases. */
export const DATABASES = ['mariadb', 'postgres', 'mongodb'];

/** The pool of the projects that name no group. */
export const DEFAULT_GROUP = 'default';

export type ShareList = true | string[];

export function recipesOf(list: ShareList | undefined): string[] {
  return list === true ? DATABASES : (list ?? []);
}

/** The declaration with each service's sharing settled, and the group that runs the shared ones. */
export function settleSharing(declaration: Declaration, machine: ShareList | undefined): Declaration {
  if (!declaration.services) return declaration;
  const listed = recipesOf(declaration.shared ?? machine);
  const services = Object.fromEntries(
    Object.entries(declaration.services).map(([name, s]) => [name, { ...s, shared: s.shared ?? listed.includes(s.recipe) }]),
  );
  const any = Object.values(services).some((s) => s.shared);
  return { ...declaration, services, ...(any ? { shareGroup: declaration.group ?? DEFAULT_GROUP } : {}) };
}

/**
 * The name of a shared server in its group: its recipe and version (`mariadb-11-4`), and a
 * digest of the other params it is asked with when they are not the recipe's defaults — one
 * server per way of asking, so projects on two versions never meet. The tenant's own params
 * (its database, its user) make no difference: every project has its own.
 */
export function serverName(recipe: string, params: Record<string, unknown>, defaults: Record<string, unknown> = {}, tenant: string[] = []): string {
  const { version, ...rest } = params;
  const others = Object.entries(rest)
    .filter(([k, v]) => v !== undefined && !tenant.includes(k) && JSON.stringify(v) !== JSON.stringify(defaults[k]))
    .sort(([a], [b]) => a.localeCompare(b));
  const digest = others.length > 0 ? `-${createHash('sha256').update(JSON.stringify(others)).digest('hex').slice(0, 6)}` : '';
  const v = version !== undefined ? `-${String(version).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
  return `${recipe}${v}${digest}`;
}
