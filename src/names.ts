/**
 * Names that end up in DNS, Docker and Traefik: kept to one safe alphabet, and hosts kept
 * inside their project's own name.
 */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Every host octopod serves is under it: the console is the domain itself. */
export const EDGE_DOMAIN = 'octopod.localhost';

/**
 * Names that sit beside a project's at the top of the domain, which no project without a
 * group can take: the edge's own (the console, Traefik's dashboard, an API), and the
 * addresses of the machine pool's shared services (`pma`, `mail`… — `RESERVED_PROJECTS`
 * is completed with the routes of the built-in recipes where projects are registered).
 * `group-*` is a group's domain.
 */
export const RESERVED_PROJECTS = ['octopod', 'traefik', 'api', 'console'];

/** Why a project may not have this name at the top of the domain, or nothing. */
export function reservedName(project: string, group: string | undefined, taken: string[] = RESERVED_PROJECTS): string | undefined {
  if (group) return undefined;
  if (project.startsWith('group-')) return `"${project}" would be a group's domain (group-<name>.${EDGE_DOMAIN}): give the project another name with project:, or a group:`;
  if (taken.includes(project)) return `"${project}" is taken at the top of ${EDGE_DOMAIN} (the edge's own, or a shared service's address): give the project another name with project:, or a group:`;
  return undefined;
}

/**
 * A project's domain, under which its hosts are: `<project>.octopod.localhost`, or
 * `<project>.group-<group>.octopod.localhost` in a group. A group's shared services (its
 * stack, `<group>-shared`) are at `group-<group>.octopod.localhost`; the machine pool's (the
 * group `default`), at `octopod.localhost` itself.
 */
export function projectDomain(project: string, group?: string): string {
  if (group && project === `${group}-shared`) return group === 'default' ? EDGE_DOMAIN : `group-${group}.${EDGE_DOMAIN}`;
  return group ? `${project}.group-${group}.${EDGE_DOMAIN}` : `${project}.${EDGE_DOMAIN}`;
}

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  return slug || 'project';
}

/**
 * The full host for a declared `host` (empty → the project's domain itself). A host is
 * always the project's domain or a name under it: `api` in project `demo` is
 * `api.demo.octopod.localhost`, and no declaration can reach another project's.
 */
export function fullHost(project: string, host: string | undefined, group?: string): string {
  const labels = host ? host.split('.') : [];
  for (const label of labels) {
    if (!LABEL_RE.test(label)) throw new Error(`host "${host}": "${label}" is not a DNS label`);
  }
  return [...labels, projectDomain(project, group)].join('.');
}

/** Compose project, edge network and router names derive from these. */
export function edgeNetwork(instance: string, project: string): string {
  return `${instance}-${project}-edge`;
}

/**
 * Instance N of a project (the `-1` of `<project>-<service>-1`): the same folder and
 * compose files under another name — `demo-2`, `demo-2.octopod.localhost`. Instance 1 is the
 * project itself.
 */
export function instanceName(project: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`instance must be 1 to 99, not ${n}`);
  if (n === 1) return project;
  const name = `${project}-${n}`;
  if (!LABEL_RE.test(name)) throw new Error(`"${name}" is not a DNS label (the project name is too long for instance ${n})`);
  return name;
}
