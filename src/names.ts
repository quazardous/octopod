/**
 * Names that end up in DNS, Docker and Traefik: kept to one safe alphabet, and hosts kept
 * inside their project's own name.
 */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  return slug || 'project';
}

/**
 * The full host for a declared `host` (empty → the project itself). A host is always the
 * project's name or a name under it: `api` in project `demo` is `api.demo.localhost`, and
 * no declaration can reach `other.localhost`.
 */
export function fullHost(project: string, host: string | undefined): string {
  const labels = host ? host.split('.') : [];
  for (const label of labels) {
    if (!LABEL_RE.test(label)) throw new Error(`host "${host}": "${label}" is not a DNS label`);
  }
  return [...labels, project, 'localhost'].join('.');
}

/** Compose project, edge network and router names derive from these. */
export function edgeNetwork(instance: string, project: string): string {
  return `${instance}-${project}-edge`;
}

/**
 * Instance N of a project (the `-1` of `<project>-<service>-1`): the same folder and
 * compose files under another name — `demo-2`, `demo-2.localhost`. Instance 1 is the
 * project itself.
 */
export function instanceName(project: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`instance must be 1 to 99, not ${n}`);
  if (n === 1) return project;
  const name = `${project}-${n}`;
  if (!LABEL_RE.test(name)) throw new Error(`"${name}" is not a DNS label (the project name is too long for instance ${n})`);
  return name;
}
