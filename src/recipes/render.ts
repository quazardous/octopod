/**
 * From a project's `services:` (each a recipe and its parameters) to a compose file.
 *
 * Everything a container gets is decided here from the recipe; the project contributes a
 * service name, a recipe id and typed parameter values. No networks and no hardening:
 * octopod routes and binds the data, and a client with stricter needs (bushwhack) adds
 * its own compose file on top.
 */
import { randomBytes } from 'node:crypto';
import { IDENT, type ParamSpec, type Recipe } from './recipe.js';
import type { RecipeBook, RecipeEntry } from './loader.js';
import { render, renderMap } from './template.js';

export interface ServiceRequest {
  recipe: string;
  params?: Record<string, unknown>;
}

export type ParamValue = string | number | boolean;

export interface RenderOptions {
  project: string;
  book: RecipeBook;
  services: Record<string, ServiceRequest>;
  /** The host folder mounted where a recipe's `workspace` says. */
  workspace: string;
  /** The operator's `uid:gid`; undefined where there is no such thing (not Linux). */
  owner?: string;
  /** Secrets generated earlier, by service: kept, so a database keeps its password. */
  secrets?: Record<string, Record<string, string>>;
  secretFactory?: (bytes: number) => string;
}

export interface RenderedService {
  name: string;
  recipe: string;
  digest: string;
  image: string;
  build: boolean;
  params: Record<string, ParamValue>;
  /** Names only. */
  secrets: string[];
  /** Compose volume names, bound by octopod to `.octopod/data/`. */
  volumes: string[];
  /** Paths a recipe could keep and does not: lost when the container is recreated. */
  ephemeral: string[];
  workspace?: string;
  port?: number;
  /** Routed: at the project's host (`''`) or at a subdomain. */
  route?: string;
  /** The services it waits for at start: those that provide what it requires. */
  waits?: { service: string; healthy: boolean }[];
}

export interface Rendered {
  compose: { services: Record<string, Record<string, unknown>>; volumes?: Record<string, null> };
  /** Files beside the compose file, by path relative to the project: build contexts. */
  files: Record<string, string>;
  services: RenderedService[];
  /** Every secret, old and new, by service — to be kept by the caller. */
  secrets: Record<string, Record<string, string>>;
}

export class RenderError extends Error {}

/** A Linux user name for the project: its name when it is one, else prefixed. */
export function userNameOf(project: string): string {
  const name = project.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 31);
  return /^[a-z_]/.test(name) ? name : `u${name}`.slice(0, 32);
}

function coerce(name: string, spec: Exclude<ParamSpec, { type: 'secret' }>, given: unknown, where: string): ParamValue {
  const value = given ?? spec.default;
  if (value === undefined) throw new RenderError(`${where}: '${name}' is required`);
  switch (spec.type) {
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) throw new RenderError(`${where}: '${name}' must be one of ${spec.values.join(', ')}`);
      return value;
    case 'ident':
      if (typeof value !== 'string' || !IDENT.test(value)) throw new RenderError(`${where}: '${name}' must match ${IDENT}`);
      return value;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new RenderError(`${where}: '${name}' must be an integer`);
      if (value < spec.min || value > spec.max) throw new RenderError(`${where}: '${name}' must be within ${spec.min}..${spec.max}`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw new RenderError(`${where}: '${name}' must be true or false`);
      return value;
  }
}

interface Resolved {
  name: string;
  entry: RecipeEntry;
  params: Record<string, ParamValue>;
  secrets: Record<string, string>;
}

function scopes(r: Resolved) {
  return { service: r.name, recipe: r.entry.id, params: r.params, secrets: r.secrets };
}

export function renderServices(options: RenderOptions): Rendered {
  const factory = options.secretFactory ?? ((bytes: number) => randomBytes(bytes).toString('base64url'));
  const kept = options.secrets ?? {};
  const resolved: Resolved[] = [];

  for (const [name, request] of Object.entries(options.services)) {
    const where = `service '${name}'`;
    if (!IDENT.test(name)) throw new RenderError(`${where}: the name must match ${IDENT}`);
    const entry = options.book.recipes.get(request.recipe);
    if (!entry) throw new RenderError(`${where}: no recipe '${request.recipe}' (octopod recipes lists them)`);
    const given = request.params ?? {};
    for (const key of Object.keys(given)) {
      if (!(key in entry.recipe.params)) throw new RenderError(`${where}: recipe '${entry.id}' has no parameter '${key}'`);
    }
    const params: Record<string, ParamValue> = {};
    const secrets: Record<string, string> = {};
    for (const [key, spec] of Object.entries(entry.recipe.params)) {
      if (spec.type === 'secret') {
        if (key in given) throw new RenderError(`${where}: '${key}' is a secret, generated by octopod — it cannot be given`);
        secrets[key] = kept[name]?.[key] ?? factory(spec.bytes);
      } else {
        params[key] = coerce(key, spec, given[key], where);
      }
    }
    resolved.push({ name, entry, params, secrets });
  }

  const services: Record<string, Record<string, unknown>> = {};
  const volumes: Record<string, null> = {};
  const files: Record<string, string> = {};
  const described: RenderedService[] = [];
  const [uid, gid] = (options.owner ?? '1000:1000').split(':');

  for (const r of resolved) {
    const recipe: Recipe = r.entry.recipe;
    const env = renderMap(recipe.env, scopes(r), `${r.name}.env`);
    const waits: { service: string; healthy: boolean }[] = [];
    for (const requirement of recipe.requires) {
      const providers = resolved.filter((o) => o.name !== r.name && o.entry.recipe.provides.includes(requirement.capability));
      if (providers.length === 0) {
        if (requirement.optional) continue;
        throw new RenderError(`service '${r.name}' requires '${requirement.capability}' — add a service that provides it`);
      }
      if (providers.length > 1) throw new RenderError(`service '${r.name}': '${requirement.capability}' is provided by ${providers.map((p) => p.name).join(' and ')}`);
      const provider = providers[0];
      const exported = renderMap(provider.entry.recipe.exports, scopes(provider), `${provider.name}.exports`);
      Object.assign(env, renderMap(requirement.env, { ...scopes(r), provider: exported }, `${r.name}.requires.${requirement.capability}`));
      // What it requires is there: it starts once its provider is ready — healthy when the
      // provider can say so, started otherwise — not before, to fail on a refused connection.
      if (!waits.some((w) => w.service === provider.name)) waits.push({ service: provider.name, healthy: Boolean(provider.entry.recipe.health) });
    }

    const service: Record<string, unknown> = { restart: 'unless-stopped' };
    const image = render(recipe.image, { params: r.params }, `${r.name}.image`);
    if (recipe.build) {
      // An empty context: the Dockerfile alone. The project never goes to the Docker daemon.
      const context = `.octopod/build/${r.name}`;
      files[`${context}/Dockerfile`] = r.entry.dockerfile!;
      const extra = renderMap(recipe.buildArgs, { params: r.params }, `${r.name}.buildArgs`);
      service.build = { context, args: { ...extra, BASE_IMAGE: image, UID: uid, GID: gid, USER_NAME: userNameOf(options.project) } };
    } else {
      service.image = image;
    }
    if (recipe.command) service.command = recipe.command.map((c, i) => render(c, scopes(r), `${r.name}.command[${i}]`));
    if (Object.keys(env).length > 0) service.environment = env;
    // Working on the project's files: as the operator, so they stay theirs.
    if (recipe.workspace && options.owner) service.user = options.owner;
    if (recipe.readOnly) service.read_only = true;
    if (recipe.tmpfs.length > 0) service.tmpfs = recipe.tmpfs;

    const mounts: string[] = [];
    const kept: string[] = [];
    const ephemeral: string[] = [];
    for (const v of recipe.volumes) {
      if (v.when !== undefined && r.params[v.when] !== true) {
        ephemeral.push(v.path);
        continue;
      }
      const volume = `${r.name}-${v.name}`;
      volumes[volume] = null;
      kept.push(volume);
      mounts.push(`${volume}:${v.path}`);
    }
    if (recipe.workspace) {
      mounts.push(`${options.workspace}:${recipe.workspace}`);
      service.working_dir = recipe.workspace;
    }
    if (mounts.length > 0) service.volumes = mounts;
    if (recipe.health) {
      service.healthcheck = {
        test: recipe.health.test.map((t, i) => render(t, scopes(r), `${r.name}.health.test[${i}]`)),
        interval: `${Math.max(1, Math.round(recipe.health.intervalMs / 1000))}s`,
        retries: recipe.health.retries,
      };
    }
    if (waits.length > 0) {
      service.depends_on = Object.fromEntries(waits.map((w) => [w.service, { condition: w.healthy ? 'service_healthy' : 'service_started' }]));
    }
    if (recipe.port) service.expose = [String(recipe.port)];
    if (recipe.profiles.length > 0) service.profiles = recipe.profiles;
    if (recipe.limits.memory) service.mem_limit = recipe.limits.memory;
    if (recipe.limits.cpus) service.cpus = Number(recipe.limits.cpus);
    if (recipe.limits.pids) service.pids_limit = recipe.limits.pids;
    services[r.name] = service;

    described.push({
      name: r.name,
      recipe: r.entry.id,
      digest: r.entry.digest,
      image,
      build: recipe.build,
      params: r.params,
      secrets: Object.keys(r.secrets),
      volumes: kept,
      ephemeral,
      ...(recipe.workspace ? { workspace: recipe.workspace } : {}),
      ...(recipe.port ? { port: recipe.port } : {}),
      ...(recipe.route ? { route: recipe.route === true ? '' : recipe.route.subdomain } : {}),
      ...(waits.length > 0 ? { waits } : {}),
    });
  }

  const compose: Rendered['compose'] = { services };
  if (Object.keys(volumes).length > 0) compose.volumes = volumes;
  return { compose, files, services: described, secrets: Object.fromEntries(resolved.map((r) => [r.name, r.secrets])) };
}

/** One screen, for an approval: what each service is, what it keeps, what it mounts. */
export function formatPlan(project: string, services: RenderedService[], workspace: string): string {
  const lines = [`project ${project}`];
  for (const s of services) {
    lines.push(`+ ${s.name}  ${s.recipe}@${s.digest}`);
    lines.push(`    image   ${s.image}${s.build ? ' — built: its user named after the project, at your uid, nothing installed' : ''}`);
    const params = Object.entries(s.params);
    if (params.length > 0) lines.push(`    params  ${params.map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (s.secrets.length > 0) lines.push(`    secrets ${s.secrets.join(', ')} (generated, kept by octopod)`);
    if (s.volumes.length > 0) lines.push(`    data    ${s.volumes.join(', ')} (in .octopod/data)`);
    if (s.ephemeral.length > 0) lines.push(`    NOT KEPT ${s.ephemeral.join(', ')} — lost when the container is recreated`);
    if (s.workspace) lines.push(`    files   ${workspace} → ${s.workspace}  READ-WRITE`);
    if (s.waits) lines.push(`    waits   for ${s.waits.map((w) => `${w.service} (${w.healthy ? 'healthy' : 'started'})`).join(', ')}`);
    if (s.route !== undefined) lines.push(`    served  ${s.route ? `${s.route}.` : ''}${project}.localhost, port ${s.port ?? 'from the image'}`);
  }
  return lines.join('\n');
}
