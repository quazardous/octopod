/**
 * From a project's `services:` (each a recipe and its parameters) to a compose file.
 *
 * Everything a container gets is decided here from the recipe; the project contributes a
 * service name, a recipe id and typed parameter values. No networks and no hardening:
 * octopod routes and binds the data, and a client with stricter needs (bushwhack) adds
 * its own compose file on top.
 */
import { projectDomain } from '../names.js';
import { serverName } from '../sharing.js';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { ProgramSpec } from '../declaration.js';
import { IDENT, type ActionSpec, type ParamSpec, type Recipe } from './recipe.js';
import type { RecipeBook, RecipeEntry } from './loader.js';
import { render, renderMap } from './template.js';

export interface ServiceRequest {
  recipe: string;
  params?: Record<string, unknown>;
  /** Programs run beside the recipe's own, when the recipe runs a supervisor. */
  programs?: Record<string, ProgramSpec>;
  /** The project's folder of supervisord files, absolute: mounted read-only where the recipe includes it. */
  supervisorD?: string;
  /** The project's own actions, beside the recipe's (a name they share is the project's). */
  actions?: Record<string, ActionSpec>;
  /** Keep its user's home: in `.octopod/home/`, or in this folder of the project (absolute). */
  home?: true | string;
  /** Where the project is mounted, instead of the recipe's workspace. */
  workdir?: string;
  /** Not routed, though the recipe would be: a worker that serves nothing over HTTP. */
  route?: false;
  /** Run once for the project's group, not by the project: see `RenderOptions.shared`. */
  shared?: boolean;
  /** Where the console's icon leads, as the project says: a path on its route, or a URL. */
  link?: string;
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
  /** Instance N of the project: its kept homes apart from the first's. */
  instance?: number;
  /** The machine octopod runs on, for `{{host.x}}` in a recipe's env; this one by default. */
  hostOs?: HostOs;
  /** The port the edge is published on, in a routed service's `{{url}}`: 80 by default. */
  edgePort?: number;
  /** The project's domain, its hosts under it: `<project>.octopod.localhost` by default (names.ts). */
  domain?: string;
  /**
   * The group's shared services (`shared: true`): run by the compose project `project`, on
   * the network `network`, which the services requiring them join. This project is their
   * tenant `tenant`: the recipe's `tenant` params and its own secret.
   */
  shared?: { project: string; network: string; tenant: string; domain?: string };
}

export type HostOs = 'linux' | 'windows' | 'macos';

export function hostOsOf(platform: NodeJS.Platform = process.platform): HostOs {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
}

/**
 * `{{host.os}}`, and `{{host.poll}}`: `true` where a change made on the host raises no file
 * event in a container (Docker Desktop on Windows), empty elsewhere — and an env entry
 * rendered empty is left out, because a watcher takes any value, `false` included, as yes.
 */
function hostScope(os: HostOs): Record<string, string> {
  return { os, poll: os === 'windows' ? 'true' : '' };
}

/** The env, its entries rendered empty left out. */
function present(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
}

export interface RenderedService {
  name: string;
  recipe: string;
  digest: string;
  image: string;
  build: boolean;
  /**
   * What its image is built from — the recipe (its Dockerfile included) and the build's
   * arguments — as a short digest, labelled on the image: when it changes, `up` builds again.
   */
  buildTag?: string;
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
  /** The project's programs, run by the recipe's supervisor. */
  programs?: string[];
  /** Run on demand only. */
  tool?: boolean;
  /** The supervisor's configuration, when the recipe runs one: what supervisorctl reads. */
  supervisor?: string;
  /** The project's folder of supervisord files, mounted at SUPERVISOR_D. */
  supervisorD?: string;
  /** Its actions, the recipe's and the project's, their commands rendered. */
  actions?: Record<string, ActionSpec>;
  /** Its user's home, kept: the host folder, relative to the project when octopod's. */
  home?: string;
  /** The services it waits for at start: those that provide what it requires. */
  waits?: { service: string; healthy: boolean }[];
  /** Run by the group, not by the project. */
  shared?: true;
  /** An app: it works on the project's files (the recipe has a workspace). */
  app?: true;
  /** Where the console's icon leads: a path on its route (the recipe's `link`, or the project's), or a URL. */
  link?: string;
  /** It has an `info` action: what runs in it, for the console's page of it. */
  info?: true;
  /** The project's services it is wired to (its requirements' providers). */
  uses?: string[];
  /** The names of the variables it gets, each with the service it comes from (none: its recipe's own). */
  gets?: { name: string; from?: string }[];
  /** A service the group runs: its server, and the project's tenancy in it. */
  sharedAs?: { project: string; server: string; tenant?: string; params: Record<string, ParamValue> };
}

/** A project's tenant in a shared service: the command that makes it, its name, its secret. */
export interface Tenancy {
  service: string;
  tenant: string;
  command: string[];
  /** Given on the command's standard input. */
  secret?: string;
  /** What the project's actions on the shared service see: the tenant's names and secret. */
  env?: Record<string, string>;
}

export interface Rendered {
  compose: { services: Record<string, Record<string, unknown>>; volumes?: Record<string, null>; networks?: Record<string, unknown> };
  /** Files beside the compose file, by path relative to the project: build contexts. */
  files: Record<string, string>;
  services: RenderedService[];
  /** Every secret, old and new, by service — to be kept by the caller. */
  secrets: Record<string, Record<string, string>>;
  /** The group's services this project uses, by its own name for each: the server it is (`mariadb-11-4`), and how it is asked for. */
  shared: Record<string, { server: string; recipe: string; params: Record<string, unknown> }>;
  /** Its tenancies in them, to make before it starts. */
  tenancies: Tenancy[];
}

/** The group's network, in a project's compose: joined by the services that require a shared one. */
export const SHARED_NETWORK = 'octopod_shared';

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
    case 'set': {
      const list = Array.isArray(value) ? value : [value];
      const unknown = list.filter((v) => typeof v !== 'string' || !spec.values.includes(v));
      if (unknown.length > 0) throw new RenderError(`${where}: '${name}' takes values among ${spec.values.join(', ')}, not ${unknown.join(', ')}`);
      return [...new Set(list as string[])].join(' ');
    }
  }
}

interface Resolved {
  name: string;
  entry: RecipeEntry;
  params: Record<string, ParamValue>;
  secrets: Record<string, string>;
  programs: Record<string, ProgramSpec>;
  supervisorD?: string;
  actions: Record<string, ActionSpec>;
  request: ServiceRequest;
}

/**
 * octopod's shell settings, sourced by the image's /etc/bash.bashrc: where you are in the
 * prompt (red as root), a history that lasts, ll and la. The user's ~/.bashrc comes after.
 */
export const BASHRC = `# octopod's shell settings: rendered by octopod, mounted read-only. Your ~/.bashrc comes after.
case $- in *i*) ;; *) return ;; esac
HISTSIZE=10000
HISTFILESIZE=20000
HISTCONTROL=ignoreboth
shopt -s histappend checkwinsize
alias ll='ls -alF' la='ls -A' l='ls -CF'
if [ "$(id -u)" = 0 ]; then octopod_c='1;31'; else octopod_c='1;32'; fi
PS1="\\[\\e[\${octopod_c}m\\]\\u@\${OCTOPOD_PROJECT:-octopod}:\${OCTOPOD_SERVICE:-?}\\[\\e[0m\\] \\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ "
unset octopod_c
if [ -f /usr/share/bash-completion/bash_completion ]; then . /usr/share/bash-completion/bash_completion; fi
`;

/** Where a supervised service reads the project's programs. */
export const PROGRAMS_FILE = '/etc/octopod/programs.conf';
/** Where a supervised service reads the project's own supervisord files (`*.conf`). */
export const SUPERVISOR_D = '/etc/octopod/supervisord.d';
/** The profile of tools: never activated, so `up` never starts them; `compose run` still can. */
export const TOOL_PROFILE = 'octopod-tool';
/** On an image octopod built: what it was built from, and for which project. */
export const BUILD_LABEL = 'octopod.build';
export const PROJECT_LABEL = 'octopod.project';

/**
 * The project's programs as supervisord entries. A crashed program is started again, with
 * supervisord's growing delay, and never takes the container down; `%` is supervisord's
 * interpolation, so doubled.
 */
export function programsConfig(programs: Record<string, ProgramSpec>, directory?: string): string {
  const lines = ['; Rendered by octopod from octopod.yaml: edit that file, not this one.'];
  for (const [name, p] of Object.entries(programs)) {
    lines.push(
      '',
      `[program:${name}]`,
      `command=${p.command.replace(/%/g, '%%')}`,
      ...(directory ? [`directory=${directory}`] : []),
      `autostart=${p.autostart}`,
      // A worker is started again whenever it ends (one may end on purpose, as a
      // `--time-limit` does); a program started by hand is a task, done once it exits 0.
      ...(p.autostart ? ['autorestart=true'] : ['autorestart=unexpected', 'startsecs=0']),
      'startretries=100',
      'stopasgroup=true',
      'killasgroup=true',
      'stdout_logfile=/dev/stdout',
      'stdout_logfile_maxbytes=0',
      'redirect_stderr=true',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * What a recipe's templates read of a service. `{{url}}`: its address at the edge, for a
 * routed service — the same from the host's browser and from the project's containers.
 */
function scopes(r: Resolved, options: RenderOptions) {
  const route = r.entry.recipe.route;
  const routed = route !== undefined && r.request.route !== false;
  const port = options.edgePort && options.edgePort !== 80 ? `:${options.edgePort}` : '';
  // A shared service is served under the group's domain, not this project's.
  const domain = r.request.shared && options.shared ? (options.shared.domain ?? projectDomain(options.shared.project)) : (options.domain ?? projectDomain(options.project));
  const url = routed ? `http://${route === true ? '' : `${route.subdomain}.`}${domain}${port}` : '';
  return { service: r.name, recipe: r.entry.id, params: tenantParams(r, options), secrets: r.secrets, url };
}

/** A shared service seen by this project: its params with the recipe's tenant ones (its own database, its own user). */
function tenantParams(r: Resolved, options: RenderOptions): Record<string, ParamValue> {
  const tenant = r.entry.recipe.tenant;
  if (!r.request.shared || !options.shared || !tenant) return r.params;
  return { ...r.params, ...renderMap(tenant.params, { tenant: options.shared.tenant }, `${r.name}.tenant.params`) };
}

/**
 * The project's services, and the admins their recipes name (`admin:`) beside them: one for a
 * service that is the project's own and the only provider of what the admin requires, when the project
 * runs no service of that admin's recipe itself. A shared service's is the group's.
 */
export function withAdmins(services: RenderOptions['services'], book: RenderOptions['book']): RenderOptions['services'] {
  const out = { ...services };
  const named = new Set(Object.values(services).map((s) => s.recipe));
  for (const [name, request] of Object.entries(services)) {
    const admin = book.recipes.get(request.recipe)?.recipe.admin;
    const needs = admin ? book.recipes.get(admin)?.recipe.requires.map((r) => r.capability) : undefined;
    if (!admin || !needs || request.shared || named.has(admin)) continue;
    // Two providers of what it requires: which one it shows is the project's to say.
    const providers = Object.values(services).filter((s) => book.recipes.get(s.recipe)?.recipe.provides.some((c) => needs.includes(c)));
    if (providers.length > 1) continue;
    const id = `${name}-admin`;
    if (id in out || !IDENT.test(id)) continue;
    out[id] = { recipe: admin };
  }
  return out;
}

export function renderServices(options: RenderOptions): Rendered {
  const factory = options.secretFactory ?? ((bytes: number) => randomBytes(bytes).toString('base64url'));
  const kept = options.secrets ?? {};
  const resolved: Resolved[] = [];

  for (const [name, request] of Object.entries(withAdmins(options.services, options.book))) {
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
    const programs = request.programs ?? {};
    const supervisor = entry.recipe.supervisor;
    if (Object.keys(programs).length > 0 && !supervisor) throw new RenderError(`${where}: recipe '${entry.id}' runs no supervisor, so it takes no programs`);
    if (request.supervisorD && !supervisor) throw new RenderError(`${where}: recipe '${entry.id}' runs no supervisor, so it takes no supervisor_d`);
    for (const program of Object.keys(programs)) {
      if (!IDENT.test(program)) throw new RenderError(`${where}: program '${program}': the name must match ${IDENT}`);
      if (supervisor?.programs.includes(program)) throw new RenderError(`${where}: program '${program}' is the recipe's own`);
    }
    for (const action of Object.keys(request.actions ?? {})) {
      if (!IDENT.test(action)) throw new RenderError(`${where}: action '${action}': the name must match ${IDENT}`);
    }
    // Rendered without the secrets in scope: a secret named in an action is refused here.
    const actions: Record<string, ActionSpec> = {};
    for (const [action, spec] of Object.entries({ ...entry.recipe.actions, ...(request.actions ?? {}) })) {
      const scope = { service: name, recipe: entry.id, params };
      actions[action] = { ...spec, command: spec.command.map((c, i) => render(c, scope, `${name}.actions.${action}.command[${i}]`)) };
    }
    if (request.home && !entry.recipe.home) throw new RenderError(`${where}: recipe '${entry.id}' has no user's home to keep`);
    if (request.workdir && !entry.recipe.workspace) throw new RenderError(`${where}: recipe '${entry.id}' mounts no workspace, so it takes no workdir`);
    resolved.push({ name, entry, params, secrets, programs, actions, request, ...(request.supervisorD ? { supervisorD: request.supervisorD } : {}) });
  }

  const services: Record<string, Record<string, unknown>> = {};
  const volumes: Record<string, null> = {};
  const files: Record<string, string> = {};
  const described: RenderedService[] = [];
  const [uid, gid] = (options.owner ?? '1000:1000').split(':');

  const shared: Rendered['shared'] = {};
  const tenancies: Tenancy[] = [];
  let joinsShared = false;
  for (const r of resolved) {
    const recipe: Recipe = r.entry.recipe;
    if (r.request.shared) {
      if (!options.shared) throw new RenderError(`service '${r.name}': shared needs the project's group`);
      // The group runs it; the project only says what it asks for, and makes its tenancy.
      const defaults = Object.fromEntries(Object.entries(recipe.params).flatMap(([k, spec]) => (spec.type !== 'secret' && spec.default !== undefined ? [[k, spec.default]] : [])));
      shared[r.name] = { server: serverName(r.entry.id, r.params, defaults, Object.keys(recipe.tenant?.params ?? {})), recipe: r.entry.id, params: r.params };
      let actions = r.actions;
      if (recipe.tenant?.command) {
        const scope = { service: r.name, tenant: options.shared.tenant, params: tenantParams(r, options) };
        const secret = recipe.tenant.secret ? r.secrets[recipe.tenant.secret] : undefined;
        const env = renderMap(recipe.tenant.env, { ...scope, secret: secret ?? '' }, `${r.name}.tenant.env`);
        tenancies.push({
          service: r.name,
          tenant: options.shared.tenant,
          command: recipe.tenant.command.map((c, i) => render(c, scope, `${r.name}.tenant.command[${i}]`)),
          ...(secret !== undefined ? { secret } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        });
        // The project's actions on its tenancy: the recipe's, those a tenant does otherwise, the project's own.
        actions = { ...r.actions };
        for (const [action, spec] of Object.entries(recipe.tenant.actions)) {
          if (r.request.actions?.[action]) continue;
          actions[action] = { ...spec, command: spec.command.map((c, i) => render(c, { service: r.name, recipe: r.entry.id, params: r.params }, `${r.name}.tenant.actions.${action}.command[${i}]`)) };
        }
      }
      described.push({
        name: r.name,
        recipe: r.entry.id,
        digest: r.entry.digest,
        image: render(recipe.image, { params: r.params }, `${r.name}.image`),
        build: recipe.build,
        params: r.params,
        secrets: Object.keys(r.secrets),
        volumes: [],
        ephemeral: [],
        shared: true,
        sharedAs: { project: options.shared.project, server: shared[r.name].server, ...(recipe.tenant?.command ? { tenant: options.shared.tenant, params: tenantParams(r, options) } : { params: {} }) },
        ...(Object.keys(actions).length > 0 ? { actions } : {}),
      });
      continue;
    }
    const host = hostScope(options.hostOs ?? hostOsOf());
    const env = present(renderMap(recipe.env, { ...scopes(r, options), host }, `${r.name}.env`));
    // The names it gets, and from which service: what an agent reads instead of guessing.
    const gets: { name: string; from?: string }[] = Object.keys(env).map((name) => ({ name }));
    const waits: { service: string; healthy: boolean }[] = [];
    const uses: string[] = [];
    let reachesShared = false;
    for (const requirement of recipe.requires) {
      const providers = resolved.filter((o) => o.name !== r.name && o.entry.recipe.provides.includes(requirement.capability));
      if (providers.length === 0) {
        if (requirement.optional) continue;
        throw new RenderError(`service '${r.name}' requires '${requirement.capability}' — add a service that provides it`);
      }
      if (providers.length > 1) throw new RenderError(`service '${r.name}': '${requirement.capability}' is provided by ${providers.map((p) => p.name).join(' and ')}`);
      const provider = providers[0];
      const exported = renderMap(provider.entry.recipe.exports, scopes(provider, options), `${provider.name}.exports`);
      const given = present(renderMap(requirement.env, { ...scopes(r, options), provider: exported, host }, `${r.name}.requires.${requirement.capability}`));
      Object.assign(env, given);
      for (const name of Object.keys(given)) {
        const i = gets.findIndex((g) => g.name === name);
        if (i >= 0) gets.splice(i, 1);
        gets.push({ name, from: provider.name });
      }
      // The group's: reached over the group's network, started by the group, not waited on here.
      if (provider.request.shared) {
        reachesShared = true;
        continue;
      }
      uses.push(provider.name);
      // What it requires is there: it starts once its provider is ready — healthy when the
      // provider can say so, started otherwise — not before, to fail on a refused connection.
      if (!waits.some((w) => w.service === provider.name)) waits.push({ service: provider.name, healthy: Boolean(provider.entry.recipe.health) });
    }

    const service: Record<string, unknown> = recipe.tool ? {} : { restart: 'unless-stopped' };
    const image = render(recipe.image, { params: r.params }, `${r.name}.image`);
    let buildTag: string | undefined;
    if (recipe.build) {
      // An empty context: the Dockerfile alone. The project never goes to the Docker daemon.
      const context = `.octopod/build/${r.name}`;
      files[`${context}/Dockerfile`] = r.entry.dockerfile!;
      const extra = renderMap(recipe.buildArgs, { params: r.params }, `${r.name}.buildArgs`);
      const workspaceArg = recipe.workspace ? { WORKSPACE: r.request.workdir ?? recipe.workspace } : {};
      const args = { ...extra, BASE_IMAGE: image, UID: uid, GID: gid, USER_NAME: userNameOf(options.project), ...workspaceArg };
      buildTag = createHash('sha256').update(r.entry.digest).update(JSON.stringify(args)).digest('hex').slice(0, 12);
      service.build = { context, args, labels: { [BUILD_LABEL]: buildTag, [PROJECT_LABEL]: options.project } };
    } else {
      service.image = image;
    }
    if (recipe.command) service.command = recipe.command.map((c, i) => render(c, scopes(r, options), `${r.name}.command[${i}]`));
    if (Object.keys(env).length > 0) service.environment = env;
    // Working on the project's files: as the operator, so they stay theirs.
    if (recipe.workspace && options.owner) service.user = options.owner;
    const workdir = recipe.workspace ? (r.request.workdir ?? recipe.workspace) : undefined;
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
    if (workdir) {
      mounts.push(`${options.workspace}:${workdir}`);
      service.working_dir = workdir;
    }
    let home: string | undefined;
    if (recipe.home) {
      // Where you are, in the prompt: the settings read these.
      service.environment = { ...(service.environment as Record<string, string> | undefined), OCTOPOD_PROJECT: options.project, OCTOPOD_SERVICE: r.name };
      files['.octopod/bashrc'] = BASHRC;
      mounts.push('./.octopod/bashrc:/etc/octopod/bashrc:ro');
      if (r.request.home) {
        const n = options.instance ?? 1;
        home = r.request.home === true ? `.octopod/home/${n > 1 ? `${n}/` : ''}${r.name}` : r.request.home;
        // A folder of the project is absolute (a drive letter on Windows); octopod's, relative.
        mounts.push(`${isAbsolute(home) ? home : `./${home}`}:/home/${userNameOf(options.project)}`);
      }
    }
    if (recipe.supervisor) {
      // Always there, empty or not, so the recipe's configuration can include it; its digest
      // as a label, so a change of programs recreates the container, whose supervisor reads
      // them at start.
      const file = `.octopod/programs.${options.project}.${r.name}.conf`;
      files[file] = programsConfig(r.programs, workdir);
      mounts.push(`./${file}:${PROGRAMS_FILE}:ro`);
      if (r.supervisorD) mounts.push(`${r.supervisorD}:${SUPERVISOR_D}:ro`);
      service.labels = { 'octopod.programs': createHash('sha256').update(files[file]).digest('hex').slice(0, 12) };
    }
    if (mounts.length > 0) service.volumes = mounts;
    if (recipe.health) {
      service.healthcheck = {
        test: recipe.health.test.map((t, i) => render(t, scopes(r, options), `${r.name}.health.test[${i}]`)),
        interval: `${Math.max(1, Math.round(recipe.health.intervalMs / 1000))}s`,
        retries: recipe.health.retries,
      };
    }
    if (waits.length > 0) {
      service.depends_on = Object.fromEntries(waits.map((w) => [w.service, { condition: w.healthy ? 'service_healthy' : 'service_started' }]));
    }
    if (recipe.port) service.expose = [String(recipe.port)];
    if (reachesShared && options.shared) {
      service.networks = ['default', SHARED_NETWORK];
      joinsShared = true;
    }
    if (recipe.tool) service.profiles = [TOOL_PROFILE];
    else if (recipe.profiles.length > 0) service.profiles = recipe.profiles;
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
      ...(buildTag ? { buildTag } : {}),
      params: r.params,
      secrets: Object.keys(r.secrets),
      volumes: kept,
      ephemeral,
      ...(workdir ? { workspace: workdir } : {}),
      ...(home ? { home } : {}),
      ...(recipe.port ? { port: recipe.port } : {}),
      ...(recipe.route && r.request.route !== false ? { route: recipe.route === true ? '' : recipe.route.subdomain } : {}),
      ...(waits.length > 0 ? { waits } : {}),
      ...(recipe.workspace ? { app: true as const } : {}),
      // An app's address is listed beside it: its icon leads where the project says, or to its info.
      ...(r.request.link ? { link: r.request.link } : recipe.route && !recipe.workspace ? { link: recipe.link } : {}),
      ...(r.actions.info ? { info: true as const } : {}),
      ...(uses.length > 0 ? { uses } : {}),
      ...(gets.length > 0 ? { gets } : {}),
      ...(Object.keys(r.programs).length > 0 ? { programs: Object.keys(r.programs) } : {}),
      ...(recipe.supervisor ? { supervisor: recipe.supervisor.config } : {}),
      ...(recipe.tool ? { tool: true } : {}),
      ...(r.supervisorD ? { supervisorD: r.supervisorD } : {}),
      ...(Object.keys(r.actions).length > 0 ? { actions: r.actions } : {}),
    });
  }

  const compose: Rendered['compose'] = { services };
  if (Object.keys(volumes).length > 0) compose.volumes = volumes;
  if (joinsShared && options.shared) compose.networks = { [SHARED_NETWORK]: { name: options.shared.network, external: true } };
  return { compose, files, services: described, secrets: Object.fromEntries(resolved.map((r) => [r.name, r.secrets])), shared, tenancies };
}

/** One screen, for an approval: what each service is, what it keeps, what it mounts. */
export function formatPlan(project: string, services: RenderedService[], workspace: string, domain = projectDomain(project)): string {
  const lines = [`project ${project}`];
  for (const s of services) {
    lines.push(`+ ${s.name}  ${s.recipe}@${s.digest}`);
    if (s.sharedAs) {
      // The group's server: its image, params and secrets are the group's, not the project's.
      const t = s.sharedAs;
      lines.push(`    shared  the group's server ${t.server} (${t.project})${t.tenant ? `, as tenant ${t.tenant}: ${Object.entries(t.params).map(([k, v]) => `${k} ${v}`).join(', ')}` : ', as it is'}`);
      if (s.actions) lines.push(`    actions ${Object.keys(s.actions).join(', ')} (octopod run ${s.name} <action>, in the group's server, as the tenant)`);
      continue;
    }
    lines.push(`    image   ${s.image}${s.build ? ' — built: its user named after the project, at your uid, nothing installed' : ''}`);
    const params = Object.entries(s.params);
    if (params.length > 0) lines.push(`    params  ${params.map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (s.secrets.length > 0) lines.push(`    secrets ${s.secrets.join(', ')} (generated, kept by octopod)`);
    if (s.volumes.length > 0) lines.push(`    data    ${s.volumes.join(', ')} (in .octopod/data)`);
    if (s.ephemeral.length > 0) lines.push(`    NOT KEPT ${s.ephemeral.join(', ')} — lost when the container is recreated`);
    if (s.workspace) lines.push(`    files   ${workspace} → ${s.workspace}  READ-WRITE`);
    if (s.programs) lines.push(`    runs    ${s.programs.join(', ')} (supervised)`);
    if (s.home) lines.push(`    home    ${s.home} (kept)`);
    if (s.supervisorD) lines.push(`    runs    the programs of ${s.supervisorD} (supervised, read-only)`);
    if (s.actions) lines.push(`    actions ${Object.keys(s.actions).join(', ')} (octopod run ${s.name} <action>)`);
    if (s.tool) lines.push(`    tool    never started by up: octopod shell ${project} ${s.name} -- <command…>`);
    if (s.gets) lines.push(`    gets    ${s.gets.map((g) => (g.from ? `${g.name} ← ${g.from}` : g.name)).join(', ')}`);
    if (s.waits) lines.push(`    waits   for ${s.waits.map((w) => `${w.service} (${w.healthy ? 'healthy' : 'started'})`).join(', ')}`);
    if (s.route !== undefined) lines.push(`    served  ${s.route ? `${s.route}.` : ''}${domain}, port ${s.port ?? 'from the image'}`);
  }
  return lines.join('\n');
}
