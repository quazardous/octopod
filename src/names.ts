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
