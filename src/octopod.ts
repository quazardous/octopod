/**
 * The edge and the projects on it.
 *
 * State lives under `$XDG_STATE_HOME/octopod/` (or `stateDir`): the edge's port and files,
 * the registry of projects, each project's generated override. Nothing is written into a
 * project.
 */
import { settleSharing, type ShareList } from './sharing.js';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { CookieJar, edgeRequest, edgeUrl, follow, type Cookie } from './edgeClient.js';
import { createConnection, createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { DECLARATION_FILE, loadDeclaration, withInstance, type Declaration } from './declaration.js';
import { lintDockerfile } from './recipes/lint.js';
import { BUILTIN_RECIPES, envRecipeDirs, loadRecipes, type Shadowed } from './recipes/loader.js';
import { BUILD_LABEL, formatPlan, PROJECT_LABEL, renderServices, SHARED_NETWORK, TOOL_PROFILE, type RenderedService, type Tenancy } from './recipes/render.js';
import { ConsoleAccess } from './consoleAccess.js';
import { cliDocker, composeUp, DockerError, type Docker } from './docker.js';
import { bindSources, choosePort, projectAllowConfig, composePorts, CONSOLE_HOST, consoleContainer, consoleNginxConfig, DASHBOARD_HOST, DATA_DIR, dataVolumes, duplicationBlockers, edgeCompose, edgeContainer, imagePorts, localOnlyConfig, projectOverride, traefikConfig, type ComposeService, type ComposeVolume, type ResolvedPort } from './generate.js';
import { edgeNetwork, fullHost, instanceName, projectDomain, RESERVED_PROJECTS, reservedName } from './names.js';

/** The version of the contract in docs/CONTRACT.md: the declaration, the API, the CLI's JSON. */
export const CONTRACT = 1;

/** octopod's own version, from its package.json — the same file from the sources and from dist/. */
/**
 * What this octopod adds to contract 1, by name: a client checks for the feature it needs,
 * since an older octopod speaks contract 1 too without it. Absent before 0.2.0: none.
 */
export const FEATURES = ['secrets', 'mcp'];

export async function version(): Promise<{ version: string; contract: number; features: string[] }> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return { version: pkg.version, contract: CONTRACT, features: FEATURES };
}

/** A secret octopod generated for a project's recipe: where it belongs, and its value. */
/** An action a service offers: `octopod run <service> <action>`. */
export interface ActionInfo {
  service: string;
  action: string;
  summary?: string;
  /** Reads its input (a file, or stdin). */
  input: boolean;
  /** Interactive: CLI only. */
  tty: boolean;
  /** What it destroys: asked before it runs. */
  confirm?: string;
}

/** A program as its supervisor reports it: RUNNING, STOPPED, BACKOFF, FATAL… and since when. */
export interface ProgramState {
  service: string;
  program: string;
  state: string;
  detail: string;
}

export interface Secret {
  project: string;
  service: string;
  name: string;
  value: string;
}

export const PREFERRED_PORT = 80;
export const FALLBACK_PORT = 8480;

export interface Route {
  /** The container port the edge routes to, once the project has been up, and where it came from. */
  port?: number;
  portSource?: ResolvedPort['source'];
  service: string;
  url: string;
}

export interface Project {
  name: string;
  root: string;
  /** The compose files used, in order: what the project declared, or found (main, then override). */
  compose: string[];
  routes: Route[];
  /** Why the project cannot be read (a broken octopod.yaml, a recipe that does not load): listed anyway. */
  problem?: string;
  /** Its group and tags, from its octopod.yaml. */
  group?: string;
  tags?: string[];
  /** The services group N shares (`<N>-shared`): not a project, shown in the projects that use them. */
  sharedOf?: string;
}

/** A known service: what the console draws (`recipe`), where its icon leads (`link`), what it is. */
export interface KnownService {
  /** The recipe it is made of: the console draws its icon. */
  recipe?: string;
  /** Where its icon leads: its route (an admin's at its `link`), or for a database its admin's. */
  link?: string;
  /** It works on the project's files. */
  app?: boolean;
  /** An app's own services it is wired to (the group's left out): the console draws them with it. */
  uses?: string[];
  /** It has an `info` action: the console's page of what runs in it (`GET …/info`). */
  info?: boolean;
  /** The names of the variables it gets, each with the service it comes from: never the values. */
  env?: { name: string; from?: string }[];
  /** The service it is the admin of (phpMyAdmin of a MariaDB): the console draws the two as one. */
  admin?: string;
}

/** A server of the group this project uses, under the project's own name for it. */
export interface SharedService extends KnownService {
  service: string;
  /** The group's server it is (`mariadb-11-4`), in `stack`. */
  server: string;
  /** The group's stack that runs it (`<group>-shared`): where its logs are. */
  stack: string;
  /** Its address at the edge, when it is routed (the inbox, the provider). */
  url?: string;
  state: string;
  health?: string;
}

export interface ProjectStatus extends Project {
  /** This status is of instance N (`<project>-N`). */
  instance?: number;
  /** The project's other instances up, when this is the first. */
  instances?: number[];
  /** `programs`: a supervised service's, as its supervisor reports them, when it runs. */
  services: ({ service: string; state: string; health?: string; programs?: { program: string; state: string; detail: string }[] } & KnownService)[];
  /** The group's servers the project uses, each in the state the group's stack has it. */
  shared?: SharedService[];
  /** Things the operator should fix, e.g. data written by a service that runs as another user. */
  warnings?: string[];
}

/** What docker says when a service's container cannot take an exec right now. */
const NOT_RUNNING = /is restarting|is not running|no container found|service ".*" is not running|cannot exec in a stopped state/i;

export interface ExecResult {
  ok: boolean;
  /**
   * `exec`: in the running service. `run`: the service was not running (stopped, or
   * restarting in a loop), so in a one-off container of it — same image, mounts, user,
   * network — kept out of the edge's routes.
   */
  mode: 'exec' | 'run';
  /** Output (or the error), the end of it when longer than the bound. */
  output: string;
  truncated: boolean;
}

export interface ShellOptions {
  /** The service to enter; the project's first routed one by default. */
  service?: string;
  instance?: number;
  /** As root (uid 0), whatever user the service runs as: no sudo in the image. */
  root?: boolean;
  /** In a fresh container of the service, for when it is not running. */
  oneshot?: boolean;
  /** A command instead of a shell. */
  command?: string[];
  /** Whether there is a terminal to attach to; without one, the command's output is streamed. */
  tty?: boolean;
}

/** bash when the image has it, else sh: the shell of a VM, whatever the image. */
export const SHELL = ['sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'];

export interface EdgeStatus {
  running: boolean;
  port: number | null;
  /** Traefik's dashboard. */
  dashboard: string | null;
  /** octopod's console: the projects, their services and logs (it needs `octopod serve`). */
  console: string | null;
}

/** A declaration as `up` uses it: its recipes rendered, and what it asks of its group. */
type Prepared = Declaration & {
  /** The group's services it uses, by its own name for each: which server, asked for how. */
  sharedServices?: Record<string, { server: string; recipe: string; params: Record<string, unknown> }>;
  /** Its tenancies in them: its own database and user, made before it starts. */
  tenancies?: Tenancy[];
};

/** One finding of `octopod doctor`: what was checked, how it is, and what to do when it is wrong. */
export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface OctopodOptions {
  stateDir?: string;
  /** Prefix of every name octopod creates in Docker; tests use their own. */
  instance?: string;
  docker?: Docker;
  /** Ports to try for the edge, in order. */
  ports?: number[];
  /** The API's unix socket, which the console relays to. */
  socket?: string;
  /** The API on 127.0.0.1 with a token instead of a socket: Windows, which has none. */
  tcp?: boolean;
}

/**
 * Where the API listens where there are no unix sockets (Windows): loopback, on a port kept
 * once chosen, and a token every request must carry — any local process can open a TCP
 * port, and a web page can send it a GET, but neither has the token. The console relay
 * adds it.
 */
export interface ApiTcp {
  port: number;
  token: string;
}

/** The header that carries the token. */
export const TOKEN_HEADER = 'x-octopod-token';

/** A port nothing listens on now, from the system. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Where `octopod serve` listens, and the console finds it. */
export function defaultSocket(): string {
  return join(process.env.XDG_RUNTIME_DIR || join(tmpdir(), `octopod-${process.getuid?.() ?? 'user'}`), 'octopod', 'octopod.sock');
}

/**
 * The API socket's folder, the operator's alone. One that exists but is not theirs was made
 * by Docker for the console before octopod's service started (an octopod before 0.3.4, after
 * a reboot): said plainly, with the way out, rather than a bare EPERM.
 */
export async function prepareSocketDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const uid = process.getuid?.();
  const owner = (await lstat(dir)).uid;
  if (uid !== undefined && owner !== uid) {
    throw new OctopodError(
      `${dir} belongs to uid ${owner}, not you: Docker made it for the console before octopod's service started. ` +
        `Give it back — sudo chown $(id -u):$(id -g) ${dir} — then: systemctl --user reset-failed octopod && systemctl --user restart octopod`,
    );
  }
  await chmod(dir, 0o700);
}

/** The operator's `uid:gid`, where there is one (not on Windows). */
function currentOwner(): string | undefined {
  return typeof process.getuid === 'function' && typeof process.getgid === 'function' ? `${process.getuid()}:${process.getgid()}` : undefined;
}

export class OctopodError extends Error {}

function defaultStateDir(): string {
  return process.env.OCTOPOD_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'octopod');
}

/** OCTOPOD_PORTS="18480,18481": the ports to try, for a test or a second instance. */
function envPorts(): number[] | undefined {
  const raw = process.env.OCTOPOD_PORTS;
  if (!raw) return undefined;
  const ports = raw.split(',').map((p) => Number(p.trim()));
  return ports.every((p) => Number.isInteger(p) && p > 0 && p < 65536) ? ports : undefined;
}

/** Whether the API answers a connection there: a unix socket, or a loopback port. */
function reachable(target: { path: string } | { host: string; port: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = 'path' in target ? createConnection(target.path) : createConnection(target.port, target.host);
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Whether something already listens on 127.0.0.1:port. */
function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * The compose file that puts a group's shared services on each project's network: one
 * network per project (made here, internal), the services on all of them.
 */
function sharedNetworks(services: string[], networks: Record<string, string>, aliases: Record<string, Record<string, string[]>>): string {
  // Keyed by project, sorted: a project joining the group adds a network and changes none,
  // which compose would recreate under the containers attached to it.
  const members = Object.keys(networks).sort();
  const key = (member: string) => `${SHARED_NETWORK}_${member}`;
  return (
    JSON.stringify(
      {
        networks: Object.fromEntries(members.map((m) => [key(m), { name: networks[m], internal: true }])),
        // On a project's network, a server answers to the project's own names for it (`db`).
        services: Object.fromEntries(
          services.map((s) => [s, { networks: { default: {}, ...Object.fromEntries(members.map((m) => [key(m), aliases[m]?.[s] ? { aliases: aliases[m][s] } : {}])) } }]),
        ),
      },
      null,
      2,
    ) + '\n'
  );
}

/** A service with no picture of its own: a box. */
const GENERIC_ICON =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Service</title><path fill="none" stroke="rgb(100,116,139)" stroke-width="2" stroke-linejoin="round" d="M12 2.5 21 7v10l-9 4.5L3 17V7z M3 7l9 4.5L21 7 M12 11.5v10"/></svg>';

/** The copy of a project's secrets beside its data, git-ignored with the rest of `.octopod/`. */
function projectSecrets(root: string, project: string): string {
  return join(root, '.octopod', `secrets.${project}.json`);
}

/** A secrets file: none when it is absent, an error when it cannot be read — never an empty set in its place. */
async function secretsFile(file: string): Promise<Record<string, Record<string, string>>> {
  const text = await readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return undefined;
    throw new OctopodError(`${file} cannot be read (${e.message}): octopod will not make new secrets over it`);
  });
  if (text === undefined) return {};
  try {
    return JSON.parse(text) as Record<string, Record<string, string>>;
  } catch (e) {
    throw new OctopodError(`${file} is not valid JSON (${(e as Error).message}): octopod will not make new secrets over it — put it right, or remove it to start again`);
  }
}

/**
 * A file written only when its content changes — a project is rendered at each read, and
 * rewriting it each time races with whoever reads it — whole or not at all, in `mode`.
 */
async function writeIfChanged(file: string, content: string, mode?: number): Promise<void> {
  const before = await readFile(file, 'utf8').catch(() => undefined);
  if (before === content) {
    if (mode !== undefined) await chmod(file, mode).catch(() => undefined);
    return;
  }
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, content, mode === undefined ? {} : { mode });
  await rename(tmp, file);
}

/** Who an OIDC sign-in on demand is for: a user of the provider, or a passing identity's claims. */
export interface OidcIdentity {
  sub?: string;
  claims?: Record<string, unknown>;
  issuer?: string;
}

export class Octopod {
  readonly stateDir: string;
  readonly instance: string;
  private readonly docker: Docker;
  private readonly ports: number[];
  readonly socket: string;
  readonly tcp: boolean;
  /** The browsers enrolled in the console, and the codes waiting to enroll one. */
  readonly access: ConsoleAccess;
  /** Set by `serve`: octopod changed on disk since it started, and it is restarting. */
  stale: () => boolean = () => false;

  constructor(options: OctopodOptions = {}) {
    this.socket = options.socket ?? defaultSocket();
    this.tcp = options.tcp ?? process.platform === 'win32';
    this.stateDir = options.stateDir ?? defaultStateDir();
    this.instance = options.instance ?? process.env.OCTOPOD_INSTANCE ?? 'octopod';
    this.docker = options.docker ?? cliDocker();
    this.ports = options.ports ?? envPorts() ?? [PREFERRED_PORT, FALLBACK_PORT];
    this.access = new ConsoleAccess(this.path('console-access.json'));
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  private path(...parts: string[]): string {
    return join(this.stateDir, ...parts);
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path(file), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await this.writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
  }

  /** Written whole or not at all: a reader never meets a half-written file, nor a killed writer. */
  private async writeAtomic(file: string, content: string, mode?: number): Promise<void> {
    await mkdir(join(this.path(file), '..'), { recursive: true });
    const tmp = `${this.path(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, content, mode === undefined ? {} : { mode });
    await rename(tmp, this.path(file));
  }

  /**
   * A project's secrets: none when it has none yet, and an error when the file cannot be read.
   * Never an empty set in its place: new passwords over a database made with the old ones
   * lock the project out of it.
   */
  private async readSecrets(project: string, root?: string): Promise<Record<string, Record<string, string>>> {
    const state = await secretsFile(this.path('projects', project, 'secrets.json'));
    if (!root) return state;
    // The copy beside the data: what a lost state (another machine, a purge) comes back from.
    // The state's values win where both have one.
    const copy = await secretsFile(projectSecrets(root, project));
    const out: Record<string, Record<string, string>> = { ...copy };
    for (const [service, values] of Object.entries(state)) out[service] = { ...copy[service], ...values };
    return out;
  }

  /** The secrets octopod's state and the project's copy hold differently: the state's are used. */
  private async secretsDiffer(declaration: Declaration): Promise<string[]> {
    const state = await secretsFile(this.path('projects', declaration.project, 'secrets.json')).catch(() => ({}) as Record<string, Record<string, string>>);
    const copy = await secretsFile(projectSecrets(declaration.root, declaration.project)).catch(() => ({}) as Record<string, Record<string, string>>);
    return Object.entries(state).flatMap(([service, values]) =>
      Object.entries(values)
        .filter(([key, value]) => copy[service]?.[key] !== undefined && copy[service][key] !== value)
        .map(([key]) => `${service}/${key}`),
    );
  }

  /** The API's port and token (TCP only): made the first time, kept after, readable by the operator only. */
  async apiTcp(): Promise<ApiTcp> {
    const saved = await this.readJson<Partial<ApiTcp>>('api.json', {});
    if (typeof saved.port === 'number' && typeof saved.token === 'string' && saved.token.length >= 32) return saved as ApiTcp;
    const api = { port: await freePort(), token: randomBytes(32).toString('hex') };
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(this.path('api.json'), JSON.stringify(api, null, 2) + '\n', { mode: 0o600 });
    return api;
  }

  private registry(): Promise<Record<string, string>> {
    return this.readJson('projects.json', {});
  }

  // ─── Edge ───────────────────────────────────────────────────────────────────

  private async edgeRunning(): Promise<boolean> {
    const out = await this.docker
      .run(['ps', '--filter', `name=^${edgeContainer(this.instance)}$`, '--format', '{{.Names}}'])
      .catch(() => '');
    return out.trim() === edgeContainer(this.instance);
  }

  async edgeStatus(): Promise<EdgeStatus> {
    const running = await this.edgeRunning();
    const { port } = await this.readJson<{ port: number | null }>('edge/edge.json', { port: null });
    const up = running && port;
    return { running, port: running ? port : null, dashboard: up ? this.url(DASHBOARD_HOST, port) : null, console: up ? this.url(CONSOLE_HOST, port) : null };
  }

  private url(host: string, port: number): string {
    return `http://${host}${port === 80 ? '' : `:${port}`}`;
  }

  /**
   * The port the edge uses, or will use: kept once chosen, so URLs do not move between
   * restarts; before that, the first free one — so routes announced before the edge
   * starts are the routes it will serve.
   */
  private async edgePort(options: { choose: boolean }): Promise<number> {
    const saved = await this.readJson<{ port?: number }>('edge/edge.json', {});
    if (saved.port) return saved.port;
    for (const port of this.ports) {
      if (!(await portTaken(port))) {
        if (options.choose) await this.writeJson('edge/edge.json', { port });
        return port;
      }
    }
    throw new OctopodError(`no free port for the edge among ${this.ports.join(', ')}`);
  }

  async edgeUp(): Promise<EdgeStatus> {
    const port = await this.edgePort({ choose: true });
    // The socket's folder, before Docker binds it into the console: Docker would create it as root.
    // With the API on TCP, no socket: the console reaches it through host.docker.internal.
    const socketDir = this.tcp ? undefined : dirname(this.socket);
    if (socketDir) await prepareSocketDir(socketDir);
    const traefik = JSON.stringify(traefikConfig(this.instance, port), null, 2) + '\n';
    const nginx = consoleNginxConfig(this.tcp ? await this.apiTcp() : basename(this.socket));
    await mkdir(this.path('edge', 'dynamic'), { recursive: true });
    await writeFile(this.path('edge', 'traefik.yml'), traefik);
    // It carries the API's token when the API is on TCP: the operator's alone, like api.json.
    await writeFile(this.path('edge', 'console.conf'), nginx, { mode: 0o600 });
    await chmod(this.path('edge', 'console.conf'), 0o600);
    const compose = edgeCompose({
      instance: this.instance,
      port,
      configFile: this.path('edge', 'traefik.yml'),
      dynamicDir: this.path('edge', 'dynamic'),
      consoleConfig: this.path('edge', 'console.conf'),
      socketDir,
      owner: currentOwner(),
      digest: createHash('sha256').update(traefik).update(nginx).digest('hex').slice(0, 12),
    });
    await this.writeJson('edge/compose.json', compose);
    // Always: compose leaves what has not changed alone, and brings what has — a console
    // added, a configuration changed — up to date.
    await composeUp(this.docker, ['compose', '-f', this.path('edge', 'compose.json'), 'up', '-d', '--remove-orphans']);
    // Docker Desktop (Windows) passes no file events through a bind mount: Traefik never
    // sees the middleware change, and keeps the console and the dashboard closed until it
    // starts again.
    if ((await this.writeLocalOnly()) && process.platform === 'win32') await this.docker.run(['restart', edgeContainer(this.instance)]);
    // After a restart the edge has lost its project networks: connect it to each again,
    // every instance of each included.
    for (const name of Object.keys(await this.registry())) {
      await this.connect(name);
      for (const n of await this.instances(name)) await this.connect(instanceName(name, n));
    }
    return this.edgeStatus();
  }

  /**
   * The middleware that keeps the console and the dashboard to the host, from the edge
   * network's subnets — known once compose has created it. Written in place atomically:
   * Traefik watches the folder. Says whether it changed.
   */
  private async writeLocalOnly(): Promise<boolean> {
    const network = `${this.instance}-edge_default`;
    const subnets = await this.subnets(network);
    if (subnets.length === 0) throw new OctopodError(`network ${network} has no subnet: the console and the dashboard stay closed`);
    return this.writeDynamic('local.yml', localOnlyConfig(subnets));
  }

  /** A network's subnets; none when it does not exist. */
  private async subnets(network: string): Promise<string[]> {
    const out = await this.docker.run(['network', 'inspect', network, '--format', '{{json .IPAM.Config}}']).catch(() => '');
    return ((JSON.parse(out.trim() || 'null') ?? []) as { Subnet?: string }[]).map((c) => c.Subnet).filter((s): s is string => !!s);
  }

  /** A file of Traefik's dynamic configuration, written in place atomically; says whether it changed. */
  private async writeDynamic(name: string, config: unknown): Promise<boolean> {
    const file = this.path('edge', 'dynamic', name);
    const content = JSON.stringify(config, null, 2) + '\n';
    if ((await readFile(file, 'utf8').catch(() => undefined)) === content) return false;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, content);
    await rename(`${file}.tmp`, file);
    return true;
  }

  /**
   * What a project's routes answer: the host, and the project's own containers. A group's
   * shared services also answer the projects that use them. Until it is written, the
   * project's routes answer nothing: closed by default.
   */
  private async writeAllowList(project: string, members: string[] = []): Promise<void> {
    const subnets = [
      ...(await this.subnets(`${this.instance}-edge_default`)),
      ...(await this.subnets(edgeNetwork(this.instance, project))),
      ...(await Promise.all(members.map((m) => this.subnets(edgeNetwork(this.instance, m))))).flat(),
    ];
    const changed = await this.writeDynamic(`from-${project}.yml`, projectAllowConfig(project, [...new Set(subnets)]));
    // Docker Desktop (Windows) passes no file events through a bind mount: Traefik reads it on restart.
    if (changed && process.platform === 'win32') await this.docker.run(['restart', edgeContainer(this.instance)]);
  }

  async edgeDown(): Promise<EdgeStatus> {
    await this.docker.run(['compose', '-f', this.path('edge', 'compose.json'), 'down']).catch(() => '');
    return this.edgeStatus();
  }

  /**
   * The console's relay, started when it is not running — after a reboot Docker cannot start
   * it before the API's folder exists (it no longer makes it, as root). Called by `serve`
   * once it listens. Nothing to do when the edge was never set up, or on TCP.
   */
  async ensureConsole(): Promise<void> {
    if (this.tcp) return;
    const name = consoleContainer(this.instance);
    const running = await this.docker.run(['inspect', '--format', '{{.State.Running}}', name]).catch(() => undefined);
    if (running?.trim() === 'false') await this.docker.run(['start', name]).catch(() => undefined);
  }

  /**
   * The edge on a project's edge network, under each of the project's hosts as an alias:
   * Docker's DNS answers `api.demo.localhost` with the edge there, so the project's routed
   * containers reach their own hosts at the URLs a browser uses. Its own hosts only, on its
   * own network. Reconnected when the hosts changed: Docker sets aliases at connection.
   */
  private async connect(project: string): Promise<void> {
    const network = edgeNetwork(this.instance, project);
    const exists = await this.docker.run(['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}']).catch(() => '');
    if (exists.trim() !== network) return;
    const edge = edgeContainer(this.instance);
    const hosts = await this.readJson<string[]>(join('projects', project, 'hosts.json'), []);
    const attached = await this.docker
      .run(['inspect', '--format', '{{json .NetworkSettings.Networks}}', edge])
      .then((out) => (JSON.parse(out.trim() || '{}') as Record<string, { Aliases?: string[] | null }>)[network])
      .catch(() => undefined);
    if (attached) {
      if (hosts.every((h) => attached.Aliases?.includes(h))) return;
      await this.docker.run(['network', 'disconnect', network, edge]).catch(() => undefined);
    }
    await this.docker.run(['network', 'connect', ...hosts.flatMap((h) => ['--alias', h]), network, edge]).catch((e: Error) => {
      if (!/already exists|already connected/i.test(e.message)) throw e;
    });
  }

  private async disconnect(project: string): Promise<void> {
    await this.docker
      .run(['network', 'disconnect', edgeNetwork(this.instance, project), edgeContainer(this.instance)])
      .catch(() => undefined);
  }

  // ─── Projects ───────────────────────────────────────────────────────────────

  /** The declaration of a project, or of its instance N (`demo-N`), its recipes rendered. */
  private async declaration(name: string, instance = 1): Promise<Prepared> {
    const registry = await this.registry();
    const root = registry[name];
    if (!root) throw new OctopodError(`no project "${name}"; register it first`);
    return this.withRecipes(await this.declarationOf(name, root, registry, instance), true);
  }

  private async declarationOf(name: string, root: string, registry: Record<string, string>, instance: number): Promise<Declaration> {
    const declaration = await loadDeclaration(root);
    if (instance === 1) return declaration;
    let copy: Declaration;
    try {
      copy = withInstance(declaration, instance);
    } catch (e) {
      throw new OctopodError((e as Error).message);
    }
    if (registry[copy.project]) throw new OctopodError(`instance ${instance} of "${name}" would be named "${copy.project}", which is a registered project`);
    return copy;
  }

  // ─── Recipes ────────────────────────────────────────────────────────────────

  /** Recipe folders for a project, from the most general to the closest. */
  private recipeDirs(declaration?: Declaration): string[] {
    return [
      BUILTIN_RECIPES,
      ...envRecipeDirs(),
      ...(declaration?.recipeDirs ?? []),
      ...(declaration ? [join(declaration.root, '.octopod', 'recipes')] : []),
    ];
  }

  private async render(declaration: Declaration, keepSecrets: boolean) {
    const book = await loadRecipes(this.recipeDirs(declaration)).catch((e: Error) => {
      throw new OctopodError(e.message);
    });
    const kept = keepSecrets ? await this.readSecrets(declaration.project, declaration.root) : {};
    try {
      return {
        book,
        rendered: renderServices({
          project: declaration.project,
          book,
          services: declaration.services ?? {},
          workspace: declaration.workspace ?? declaration.root,
          owner: currentOwner(),
          secrets: kept,
          edgePort: await this.edgePort({ choose: false }).catch(() => undefined),
          domain: projectDomain(declaration.project, declaration.group),
          ...(declaration.shareGroup
            ? {
                shared: {
                  project: this.sharedOf(declaration.shareGroup).project,
                  network: this.sharedNetwork(declaration.shareGroup, declaration.project),
                  tenant: declaration.project,
                  domain: projectDomain(this.sharedOf(declaration.shareGroup).project, declaration.shareGroup),
                },
              }
            : {}),
          ...(declaration.instance ? { instance: declaration.instance } : {}),
          ...(keepSecrets ? {} : { secretFactory: () => '‹generated›' }),
        }),
      };
    } catch (e) {
      throw new OctopodError((e as Error).message);
    }
  }

  /**
   * A declaration with services made of recipes becomes one with one more compose file:
   * rendered into the project's `.octopod/` (with its build contexts), its routed services
   * exposed unless the project exposes them itself. Secrets generated for it are kept in
   * octopod's state, never in the project.
   */
  private async withRecipes(asDeclared: Declaration, write: boolean): Promise<Prepared> {
    if (!asDeclared.services) return asDeclared;
    // Which services the group runs, as the project or the machine says: settled first.
    const declaration = settleSharing(asDeclared, await this.shareDefault());
    let { rendered } = await this.render(declaration, write);
    const dir = join(declaration.root, '.octopod');
    const composeFile = join(dir, `recipes.${declaration.project}.json`);
    if (write) {
      // Every read of a project renders it (status, logs, the console's refresh): its secrets
      // are written only when one is new, and a secret kept is never replaced — not by this
      // rendering, nor by another process's that made a new one at the same moment. A
      // service gone from this rendering keeps its secrets too: its data may still need them.
      const file = join('projects', declaration.project, 'secrets.json');
      const stateKept = await secretsFile(this.path(file));
      const kept = await this.readSecrets(declaration.project, declaration.root);
      const merged: Record<string, Record<string, string>> = { ...kept };
      for (const [service, values] of Object.entries(rendered.secrets)) merged[service] = { ...values, ...kept[service] };
      if (JSON.stringify(merged) !== JSON.stringify(stateKept)) {
        await this.writeSecret(file, merged);
        // Another process kept other values first: render with those.
        if (Object.entries(rendered.secrets).some(([service, values]) => Object.entries(values).some(([k, v]) => merged[service][k] !== v))) {
          ({ rendered } = await this.render(declaration, write));
        }
      }
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined);
      // A copy beside the data they unlock, unless it holds other values (said by status):
      // the data was made with the state's, or the copy's, and octopod does not guess which.
      const copy = projectSecrets(declaration.root, declaration.project);
      const secrets = await this.readSecrets(declaration.project);
      if ((await this.secretsDiffer(declaration)).length === 0) {
        const old = await secretsFile(copy).catch(() => ({}) as Record<string, Record<string, string>>);
        const both: Record<string, Record<string, string>> = { ...old };
        for (const [service, values] of Object.entries(secrets)) both[service] = { ...old[service], ...values };
        await writeIfChanged(copy, JSON.stringify(both, null, 2) + '\n', 0o600);
      }
      // The compose file carries the secrets in its environment: the operator's alone.
      await writeIfChanged(composeFile, JSON.stringify(rendered.compose, null, 2) + '\n', 0o600);
      for (const [path, content] of Object.entries(rendered.files)) {
        await mkdir(join(declaration.root, dirname(path)), { recursive: true });
        await writeIfChanged(join(declaration.root, path), content);
      }
      // A kept home in .octopod/, created as the operator: docker would create it as root.
      for (const service of rendered.services) {
        if (service.home && !isAbsolute(service.home)) await mkdir(join(declaration.root, service.home), { recursive: true });
      }
    }
    const declared = new Set(declaration.expose.map((e) => e.service));
    const expose = [...declaration.expose];
    for (const service of rendered.services) {
      if (service.route === undefined || declared.has(service.name)) continue;
      const host = fullHost(declaration.project, service.route || undefined, declaration.group);
      const taken = expose.find((e) => e.host === host);
      if (taken) throw new OctopodError(`services ${taken.service} and ${service.name} both want ${host}: expose one of them under a host of its own`);
      expose.push({ service: service.name, host });
    }
    // Tools' profile is never activated: `up` leaves them alone, `compose run` starts one.
    const profiles = [...new Set(Object.values(rendered.compose.services).flatMap((svc) => (svc.profiles as string[] | undefined) ?? []))].filter((p) => p !== TOOL_PROFILE);
    const tools = rendered.services.filter((s) => s.tool).map((s) => s.name);
    const shared = Object.keys(rendered.shared).length > 0 ? { sharedServices: rendered.shared, tenancies: rendered.tenancies } : {};
    return { ...declaration, compose: [composeFile, ...declaration.compose], expose, ...(profiles.length > 0 ? { profiles } : {}), ...(tools.length > 0 ? { tools } : {}), ...shared };
  }

  /** The recipes a project (or any project) can name, and where each comes from. */
  async recipes(root?: string): Promise<{ recipes: { id: string; title: string; summary: string; dir: string; digest: string }[]; shadowed: Shadowed[] }> {
    const declaration = root ? await loadDeclaration(root).catch(() => ({ root, project: '', compose: [], expose: [] }) as Declaration) : undefined;
    const book = await loadRecipes(this.recipeDirs(declaration)).catch((e: Error) => {
      throw new OctopodError(e.message);
    });
    return {
      recipes: [...book.recipes.values()].map((e) => ({ id: e.id, title: e.recipe.title, summary: e.recipe.summary, dir: e.dir, digest: e.digest })),
      shadowed: book.shadowed,
    };
  }

  /**
   * A recipe's icon (an SVG of its folder), the one a project sees when it is named — its own
   * recipe folders included; a plain glyph for a recipe without one, or unknown.
   */
  async recipeIcon(id: string, project?: string): Promise<string> {
    const registry = await this.registry();
    const declaration = project && registry[project] ? await loadDeclaration(registry[project]).catch(() => undefined) : undefined;
    const book = await loadRecipes(this.recipeDirs(declaration)).catch(() => undefined);
    const entry = book?.recipes.get(id);
    if (entry?.recipe.icon) {
      const svg = await readFile(join(entry.dir, entry.id, entry.recipe.icon), 'utf8').catch(() => undefined);
      if (svg) return svg;
    }
    return GENERIC_ICON;
  }

  /** Each built recipe's Dockerfile against octopod's rules (`recipes --check`): a help, not a gate. */
  async checkRecipes(root?: string): Promise<{ recipes: { id: string; dir: string; problems: string[] }[] }> {
    const declaration = root ? await loadDeclaration(root).catch(() => ({ root, project: '', compose: [], expose: [] }) as Declaration) : undefined;
    const book = await loadRecipes(this.recipeDirs(declaration)).catch((e: Error) => {
      throw new OctopodError(e.message);
    });
    return {
      recipes: [...book.recipes.values()].filter((e) => e.dockerfile !== undefined).map((e) => ({ id: e.id, dir: e.dir, problems: lintDockerfile(e.dockerfile ?? '') })),
    };
  }

  /** What `up` would run for a project folder, registered or not: for an approval. Writes nothing. */
  async plan(root: string, instance = 1): Promise<{ project: string; text: string; services: RenderedService[]; compose: unknown }> {
    let declaration = await loadDeclaration(root).catch((e: Error) => {
      throw new OctopodError(e.message);
    });
    if (instance > 1) declaration = withInstance(declaration, instance);
    declaration = settleSharing(declaration, await this.shareDefault());
    const { rendered } = await this.render(declaration, false);
    return {
      project: declaration.project,
      text: formatPlan(declaration.project, rendered.services, declaration.workspace ?? declaration.root, projectDomain(declaration.project, declaration.group)),
      services: rendered.services,
      compose: rendered.compose,
    };
  }

  private async writeSecret(file: string, value: unknown): Promise<void> {
    await this.writeAtomic(file, JSON.stringify(value, null, 2) + '\n', 0o600);
  }

  /** The instances beyond the first that have been brought up and not down. */
  private instances(base: string): Promise<number[]> {
    return this.readJson<number[]>(join('projects', base, 'instances.json'), []);
  }

  private async noteInstance(base: string, instance: number, running: boolean): Promise<void> {
    const now = new Set(await this.instances(base));
    if (running) now.add(instance);
    else now.delete(instance);
    await this.writeJson(join('projects', base, 'instances.json'), [...now].sort((a, b) => a - b));
  }

  private async routes(declaration: Declaration): Promise<Route[]> {
    const port = await this.edgePort({ choose: false });
    const resolved = await this.readJson<Record<string, ResolvedPort>>(join('projects', declaration.project, 'ports.json'), {});
    return declaration.expose.map((e) => {
      const r = resolved[e.host];
      return { service: e.service, url: this.url(e.host, port), ...(r ? { port: r.port, portSource: r.source } : {}) };
    });
  }

  /** The TCP ports an image exposes; pulled or built first when it is not there yet. */
  private async imageExposed(declaration: Declaration, service: string, spec: ComposeService): Promise<number[]> {
    const image = spec.image ?? `${declaration.project}-${service}`;
    const inspect = (): Promise<string> => this.docker.run(['image', 'inspect', image, '--format', '{{json .Config.ExposedPorts}}']);
    let out = await inspect().catch(() => undefined);
    if (out === undefined) {
      await this.docker.run([...this.composeArgs(declaration, false), spec.build ? 'build' : 'pull', service]).catch(() => '');
      out = await inspect().catch(() => 'null');
    }
    return imagePorts(JSON.parse(out.trim() || 'null') as Record<string, unknown> | null);
  }

  /** The port of each exposure: declared, else the compose file's, else the image's, else a guess. */
  private async resolvePorts(declaration: Declaration, services: Record<string, ComposeService>): Promise<Record<string, ResolvedPort>> {
    const out: Record<string, ResolvedPort> = {};
    for (const e of declaration.expose) {
      const spec = services[e.service] ?? {};
      const compose = composePorts(spec);
      const image = e.port === undefined && compose.length === 0 ? await this.imageExposed(declaration, e.service, spec) : [];
      out[e.host] = choosePort(e.port, compose, image);
    }
    return out;
  }

  private async project(declaration: Declaration): Promise<Project> {
    return {
      name: declaration.project,
      root: declaration.root,
      ...(declaration.group ? { group: declaration.group } : {}),
      ...(declaration.tags ? { tags: declaration.tags } : {}),
      ...(declaration.group && this.isSharedStack(declaration) ? { sharedOf: declaration.group } : {}),
      compose: declaration.compose,
      routes: await this.routes(declaration),
    };
  }

  async register(root: string): Promise<Project> {
    const declaration = await loadDeclaration(root);
    const registry = await this.registry();
    // A name that is another project's running instance (`demo-2`) is taken.
    const copyOf = /^(.+)-(\d+)$/.exec(declaration.project);
    if (copyOf && registry[copyOf[1]] && (await this.instances(copyOf[1])).includes(Number(copyOf[2]))) {
      throw new OctopodError(`"${declaration.project}" is instance ${copyOf[2]} of project "${copyOf[1]}"`);
    }
    const owner = registry[declaration.project];
    if (owner && owner !== root) throw new OctopodError(`project "${declaration.project}" is already registered from ${owner}`);
    // Beside the machine pool's shared services at the top of the domain: their addresses are taken.
    const pool = [...(await loadRecipes([BUILTIN_RECIPES])).recipes.values()].flatMap((e) => (e.recipe.route && e.recipe.route !== true ? [e.recipe.route.subdomain] : []));
    const reserved = reservedName(declaration.project, declaration.group, [...RESERVED_PROJECTS, ...pool]);
    if (reserved) throw new OctopodError(reserved);
    registry[declaration.project] = root;
    await this.writeJson('projects.json', registry);
    return this.project(await this.withRecipes(declaration, false));
  }

  /**
   * The project declared in a folder, registered if it is not yet — what `octopod up` does
   * in a freshly cloned project. A name already registered from another folder is refused,
   * as `register` refuses it.
   */
  async ensureRegistered(root: string): Promise<{ name: string; registered: boolean }> {
    const declaration = await loadDeclaration(root);
    const registry = await this.registry();
    if (registry[declaration.project] === root) return { name: declaration.project, registered: false };
    await this.register(root);
    return { name: declaration.project, registered: true };
  }

  /**
   * Every registered project — or those of a group, or carrying a tag. One that cannot be
   * read is listed with its problem (and only when nothing is filtered): it never hides the others.
   */
  async list(filter: { group?: string; tag?: string } = {}): Promise<Project[]> {
    const out: Project[] = [];
    const filtered = filter.group !== undefined || filter.tag !== undefined;
    for (const [name, root] of Object.entries(await this.registry())) {
      try {
        const project = await this.project(await this.declaration(name));
        if (filter.group !== undefined && project.group !== filter.group) continue;
        if (filter.tag !== undefined && !project.tags?.includes(filter.tag)) continue;
        out.push(project);
      } catch (e) {
        // Between a change of octopod on disk and the service's restart, old code reads new
        // recipes: say so, rather than what the old code made of them.
        const why = this.stale() ? `octopod changed on disk since this service started: it is restarting (${(e as Error).message})` : (e as Error).message;
        if (!filtered) out.push({ name, root, compose: [], routes: [], problem: why });
      }
    }
    return out;
  }

  private composeArgs(declaration: Declaration, withOverride: boolean): string[] {
    const files = declaration.compose.flatMap((f) => ['-f', f]);
    const override = withOverride ? ['-f', this.path('projects', declaration.project, 'override.json')] : [];
    const envFile = declaration.envFile ? ['--env-file', declaration.envFile] : [];
    const profiles = (declaration.profiles ?? []).flatMap((p) => ['--profile', p]);
    return ['compose', '-p', declaration.project, '--project-directory', declaration.root, ...envFile, ...profiles, ...files, ...override];
  }

  /**
   * The project's whole configuration, tools included: their volumes are bound into
   * .octopod/data like the others' (or `compose run` would make them Docker volumes), and
   * removed with them.
   */
  private configArgs(declaration: Declaration): string[] {
    const tools = declaration.tools ? ['--profile', TOOL_PROFILE] : [];
    return [...this.composeArgs(declaration, false), ...tools, 'config', '--format', 'json'];
  }

  async up(name: string, instance = 1): Promise<ProjectStatus> {
    const declaration = await this.declaration(name, instance);
    const config = JSON.parse(await this.docker.run(this.configArgs(declaration))) as {
      services?: Record<string, ComposeService>;
      volumes?: Record<string, ComposeVolume>;
    };
    if (instance > 1) {
      const blockers = duplicationBlockers(config.services ?? {});
      if (blockers.length > 0) throw new OctopodError(`"${name}" cannot run twice: ${blockers.join('; ')}`);
    }
    const data = dataVolumes(declaration.root, config.volumes ?? {}, instance);
    await this.prepareData(declaration, config.volumes ?? {}, data);
    // The project's folders its services mount: a missing one, Docker would create as root.
    const binds = bindSources(declaration.root, config.services ?? {});
    for (const source of binds) {
      if (!(await stat(source).then(() => true, () => false))) await mkdir(source, { recursive: true });
    }
    await this.writeJson(join('projects', declaration.project, 'binds.json'), binds);
    const ports = await this.resolvePorts(declaration, config.services ?? {});
    await this.writeJson(join('projects', declaration.project, 'ports.json'), ports);
    const override = projectOverride(this.instance, declaration, config.services ?? {}, data, Object.fromEntries(Object.entries(ports).map(([h, r]) => [h, r.port])));
    await this.writeJson(join('projects', declaration.project, 'override.json'), override);
    await this.edgeUp();
    // The group's services first: the project's network to them, and its tenancies, must be there.
    const sharedHosts = declaration.sharedServices ? await this.upShared(declaration) : [];
    await this.writeJson(join('projects', declaration.project, 'hosts.json'), [...new Set([...declaration.expose.map((e) => e.host), ...sharedHosts])]);
    // compose builds an image only when it is missing: one whose recipe or build arguments
    // changed is built again here, before up recreates its container.
    const stale = await this.staleBuilds(declaration);
    if (stale.length > 0) await this.docker.run([...this.composeArgs(declaration, true), 'build', ...stale]);
    // --remove-orphans: a service the project no longer runs (now the group's, or gone from
    // its files) is taken away, its data left where it is.
    await composeUp(this.docker, [...this.composeArgs(declaration, true), 'up', '-d', '--remove-orphans']);
    await this.forgetOrphanVolumes(declaration, config.volumes ?? {});
    // Tools are not started, but built now: run on demand, they answer at once.
    if (declaration.tools) await this.docker.run([...this.composeArgs(declaration, true), '--profile', TOOL_PROFILE, 'build', ...declaration.tools]);
    // The images those builds replaced, now nameless: the project's only.
    if (stale.length > 0 || declaration.tools) {
      await this.docker.run(['image', 'prune', '-f', '--filter', `label=${PROJECT_LABEL}=${declaration.project}`]).catch(() => undefined);
    }
    await this.connect(declaration.project);
    // Its routes answer the host and its own containers; a group's shared services, the
    // projects that use them too — this one among them, now that its network exists.
    const group = declaration.group;
    await this.writeAllowList(declaration.project, group && declaration.project === this.sharedOf(group).project ? await this.sharedMembers(group) : []);
    if (declaration.shareGroup && declaration.sharedServices) await this.writeAllowList(this.sharedOf(declaration.shareGroup).project, await this.sharedMembers(declaration.shareGroup));
    if (instance > 1) await this.noteInstance(name, instance, true);
    return this.status(name, instance);
  }

  /**
   * The volume objects of services the project no longer runs: octopod's pointers to its
   * `.octopod/data` only — the data stays, and a volume of Docker's own storage is left alone.
   */
  private async forgetOrphanVolumes(declaration: Declaration, volumes: Record<string, ComposeVolume>): Promise<void> {
    const kept = new Set(Object.entries(volumes).map(([key, v]) => v.name ?? `${declaration.project}_${key}`));
    const listed = await this.docker.run(['volume', 'ls', '--filter', `label=com.docker.compose.project=${declaration.project}`, '--format', '{{.Name}}']).catch(() => '');
    const ours = join(declaration.root, DATA_DIR);
    for (const name of listed.split('\n').map((l) => l.trim()).filter((l) => l && !kept.has(l))) {
      const options = await this.docker.run(['volume', 'inspect', name, '--format', '{{json .Options}}']).catch(() => 'null');
      const device = ((JSON.parse(options.trim() || 'null') ?? {}) as Record<string, string>).device ?? '';
      if (device === ours || device.startsWith(`${ours}/`)) await this.docker.run(['volume', 'rm', name]).catch(() => undefined);
    }
  }

  /**
   * The data folders, in the project, before compose binds them; and a refusal when a
   * volume of the same name already holds data in Docker's storage — binding over it would
   * hide that data, and moving it is the operator's call.
   */
  private async prepareData(declaration: Declaration, volumes: Record<string, ComposeVolume>, data: Record<string, string>): Promise<void> {
    if (Object.keys(data).length === 0) return;
    const dir = join(declaration.root, '.octopod');
    await mkdir(dir, { recursive: true });
    // The data is the project's, not its history: git leaves the folder alone, and the
    // project's own .gitignore is not touched.
    await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined);
    for (const [key, device] of Object.entries(data)) {
      const volume = volumes[key]?.name ?? `${declaration.project}_${key}`;
      const found = await this.docker.run(['volume', 'inspect', volume, '--format', '{{json .Options}}']).catch(() => undefined);
      if (found !== undefined) {
        const options = (JSON.parse(found.trim() || 'null') ?? {}) as Record<string, string>;
        if (options.device !== device) {
          throw new OctopodError(
            `volume ${volume} already holds data in Docker's storage; octopod keeps data in the project (${DATA_DIR}/${key}). ` +
              `Copy it there and remove the volume, then up again: ` +
              `docker run --rm -v ${volume}:/from -v ${device}:/to alpine cp -a /from/. /to/ && docker volume rm ${volume}`,
          );
        }
      }
      await mkdir(device, { recursive: true });
    }
  }

  /**
   * The Docker volume objects octopod bound into the project: pointers only — the data is
   * in `.octopod/data` and stays. Left behind, a pointer to a folder that moved would make
   * the next `up` of the same name refuse. Volumes the project configured itself are not
   * octopod's and are left alone.
   */
  private async forgetDataVolumes(name: string, instance: number): Promise<void> {
    const declaration = await this.declaration(name, instance).catch(() => undefined);
    if (!declaration) return;
    const config = await this.docker
      .run(this.configArgs(declaration))
      .then((out) => JSON.parse(out) as { volumes?: Record<string, ComposeVolume> })
      .catch(() => undefined);
    for (const key of Object.keys(dataVolumes(declaration.root, config?.volumes ?? {}, instance))) {
      const volume = config?.volumes?.[key]?.name ?? `${declaration.project}_${key}`;
      await this.docker.run(['volume', 'rm', volume]).catch(() => undefined);
    }
  }

  /** A port octopod had to choose or guess: said, so a wrong one is found in a glance. */
  private async portWarnings(declaration: Declaration): Promise<string[]> {
    const resolved = await this.readJson<Record<string, ResolvedPort>>(join('projects', declaration.project, 'ports.json'), {});
    const out: string[] = [];
    for (const [host, r] of Object.entries(resolved)) {
      if (r.source === 'guess') out.push(`${host}: no port found in the compose file or the image; routing to ${r.port} — set port: in octopod.yaml`);
      else if (r.candidates.length > 1) out.push(`${host}: port ${r.port} chosen among ${r.candidates.join(', ')} (${r.source}) — set port: in octopod.yaml for another`);
    }
    return out;
  }

  /**
   * Data folders holding files the operator does not own: a service that writes as root
   * (or as its image's own user) leaves files in the project that only root can delete.
   * octopod does not force a user on an image; it says which folder, so the service gets
   * a `user:` or its Dockerfile is adjusted.
   */
  private async foreignData(declaration: Declaration): Promise<string[]> {
    const uid = process.getuid?.();
    if (uid === undefined) return [];
    const base = join(declaration.root, DATA_DIR);
    const folders = await readdir(base).catch(() => [] as string[]);
    const out: string[] = [];
    for (const folder of folders) {
      const dir = join(base, folder);
      const entries = [dir, ...(await readdir(dir).catch(() => [] as string[])).map((e) => join(dir, e))];
      const owners = new Set<number>();
      for (const entry of entries) {
        const info = await lstat(entry).catch(() => undefined);
        if (info && info.uid !== uid) owners.add(info.uid);
      }
      if (owners.size > 0) {
        out.push(`${DATA_DIR}/${folder} holds files owned by uid ${[...owners].join(', ')}, not you: run the service that writes it as your user (user: in compose, or in its Dockerfile)`);
      }
    }
    return out;
  }

  /**
   * The project's mounted folders (as `up` last found them) that the operator does not own:
   * what a service writes there, or what Docker created there as root before octopod made
   * them, the operator can neither change nor remove. `.octopod/data` is foreignData's.
   */
  private async foreignBinds(declaration: Declaration): Promise<string[]> {
    const uid = process.getuid?.();
    if (uid === undefined) return [];
    const binds = await this.readJson<string[]>(join('projects', declaration.project, 'binds.json'), []);
    const data = join(declaration.root, DATA_DIR);
    const out: string[] = [];
    for (const source of binds) {
      if (source === data || source.startsWith(`${data}/`)) continue;
      const info = await lstat(source).catch(() => undefined);
      if (info && info.uid !== uid) {
        out.push(`${relative(declaration.root, source)} is owned by uid ${info.uid}, not you: neither you nor a service running as you can write there — give it back (sudo chown -R $(id -u):$(id -g) ${source})`);
      }
    }
    return out;
  }

  async down(name: string, options: { volumes?: boolean; instance?: number; images?: boolean } = {}): Promise<ProjectStatus> {
    const instance = options.instance ?? 1;
    const declaration = await this.declaration(name, instance);
    // Before `down`: compose cannot remove a network the edge is still attached to.
    await this.disconnect(declaration.project);
    // `--rmi local`: the images compose built for the project (recipes that build), never a pulled one.
    // Tools' profile too: their image goes with the others, and a one-off left behind with them.
    const tools = declaration.services ? ['--profile', TOOL_PROFILE] : [];
    await this.docker.run([...this.composeArgs(declaration, true), ...tools, 'down', ...(options.volumes ? ['--volumes'] : []), ...(options.images ? ['--rmi', 'local'] : [])]);
    if (instance > 1) await this.noteInstance(name, instance, false);
    if (declaration.sharedServices && declaration.shareGroup) await this.downSharedWhenIdle(declaration.shareGroup);
    return this.status(name, instance);
  }

  // ─── A group's shared services ──────────────────────────────────────────────

  /**
   * Where a group's shared services live: a project of their own, `<group>-shared`, made by
   * octopod in its state directory (its data too: it belongs to no one project), on a
   * network the projects that use them join.
   */
  private sharedOf(group: string): { project: string; dir: string } {
    return { project: `${group}-shared`, dir: this.path('groups', group) };
  }

  /**
   * The network between a group's shared services and one project: one per project, so a
   * project reaches the shared services and nothing of the group's other projects.
   */
  private sharedNetwork(group: string, project: string): string {
    return `${this.instance}-${group}-shared-${project}`;
  }

  /** The machine's default for `shared:` (`octopod share`): what every project shares unless it says otherwise. */
  async shareDefault(): Promise<ShareList | undefined> {
    return (await this.readJson<{ share?: ShareList }>('config.json', {})).share;
  }

  /** Sets the machine's default (`true`: the databases; a list of recipes), or clears it (`null`). */
  async setShareDefault(share: ShareList | null): Promise<{ share: ShareList | null }> {
    const config = await this.readJson<Record<string, unknown>>('config.json', {});
    if (share === null) delete config.share;
    else config.share = share;
    await this.writeJson('config.json', config);
    return { share };
  }

  /**
   * The projects that use a group's shared services, each instance by its own name, with
   * which servers each uses under which of its own names. The group's own stack is none.
   */
  private async membersOf(group: string): Promise<{ name: string; base: string; instance: number; shared: NonNullable<Prepared['sharedServices']> }[]> {
    const machine = await this.shareDefault();
    const members: { name: string; base: string; instance: number; shared: NonNullable<Prepared['sharedServices']> }[] = [];
    for (const [name, root] of Object.entries(await this.registry())) {
      if (name === this.sharedOf(group).project) continue;
      const declared = await loadDeclaration(root).catch(() => undefined);
      if (!declared) continue;
      const settled = settleSharing(declared, machine);
      if (settled.shareGroup !== group) continue;
      const prepared = await this.withRecipes(settled, false).catch(() => undefined);
      if (!prepared?.sharedServices) continue;
      for (const n of [1, ...(await this.instances(name))]) members.push({ name: instanceName(name, n), base: name, instance: n, shared: prepared.sharedServices });
    }
    return members;
  }

  /** The names of the projects that use a group's shared services: who their routes answer. */
  private async sharedMembers(group: string): Promise<string[]> {
    return (await this.membersOf(group)).map((m) => m.name);
  }

  /**
   * The group's shared servers up — one per recipe and way of asking (`mariadb-11-4`), each
   * known in a project by the project's own name for it — then this project's tenancies made
   * in them. Returns their hosts: the project reaches them at the browser's URLs too.
   */
  private async upShared(declaration: Prepared): Promise<string[]> {
    const group = declaration.shareGroup!;
    const { project, dir } = this.sharedOf(group);
    const registry = await this.registry();
    if (registry[project] && registry[project] !== dir) throw new OctopodError(`"${project}" is a registered project: group ${group}'s shared services need that name`);
    const members = (await this.membersOf(group)).filter((m) => m.name !== declaration.project);
    members.push({ name: declaration.project, base: declaration.project, instance: declaration.instance ?? 1, shared: declaration.sharedServices! });
    const servers: Record<string, { recipe: string; params: Record<string, unknown> }> = {};
    const aliases: Record<string, Record<string, string[]>> = {};
    for (const m of members) {
      for (const [local, s] of Object.entries(m.shared)) {
        servers[s.server] = { recipe: s.recipe, params: s.params };
        ((aliases[m.name] ??= {})[s.server] ??= []).push(local);
      }
    }
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, DECLARATION_FILE),
      // shared: false — the stack runs them; it shares nothing with anyone.
      JSON.stringify({ project, group, compose: ['network.json'], services: Object.fromEntries(Object.entries(servers).map(([s, r]) => [s, { recipe: r.recipe, ...r.params, shared: false }])) }, null, 2) + '\n',
    );
    await writeFile(join(dir, 'network.json'), sharedNetworks(Object.keys(servers), Object.fromEntries(members.map((m) => [m.name, this.sharedNetwork(group, m.name)])), aliases));
    if (!registry[project]) await this.writeJson('projects.json', { ...registry, [project]: dir });
    await this.up(project);
    // A tenancy is made in a running server, ready: healthy, when it can say so.
    const serverOf = (local: string) => declaration.sharedServices![local]!.server;
    const waiting = [...new Set((declaration.tenancies ?? []).map((t) => serverOf(t.service)))];
    for (let i = 0; waiting.length > 0; i++) {
      const status = await this.status(project);
      const ready = waiting.every((s) => status.services.some((x) => x.service === s && x.state === 'running' && (!x.health || x.health === 'healthy')));
      if (ready) break;
      if (i >= 120) throw new OctopodError(`group ${group}'s ${waiting.join(', ')} not ready after 2 minutes: octopod logs ${project}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const stack = await this.declaration(project);
    for (const t of declaration.tenancies ?? []) {
      // The secret on the command's input, never on a command line.
      await this.docker
        .run([...this.composeArgs(stack, true), 'exec', '-T', '-e', `TENANT=${t.tenant}`, serverOf(t.service), ...t.command], { input: `${t.secret ?? ''}\n`, timeoutMs: 60_000, withStderr: true })
        .catch((e: Error) => {
          throw new OctopodError(`${t.tenant}'s tenancy in ${project}/${serverOf(t.service)} failed: ${e.message}`);
        });
    }
    return this.readJson<string[]>(join('projects', project, 'hosts.json'), []);
  }

  /** The group's shared services down, once no project that uses them runs. */
  private async downSharedWhenIdle(group: string): Promise<void> {
    const { project } = this.sharedOf(group);
    if (!(await this.registry())[project]) return;
    for (const m of await this.membersOf(group)) {
      const status = await this.status(m.base, m.instance).catch(() => undefined);
      if (status?.services.some((s) => s.state === 'running')) return;
    }
    await this.down(project);
  }

  async status(name: string, instance = 1): Promise<ProjectStatus> {
    const declaration = await this.declaration(name, instance);
    const out = await this.docker.run([...this.composeArgs(declaration, false), 'ps', '--all', '--format', 'json']).catch((e: DockerError) => {
      throw new OctopodError(e.message);
    });
    // One JSON object per line (compose v2+), or an array (older versions).
    const rows = out.trim().startsWith('[')
      ? (JSON.parse(out) as Record<string, string>[])
      : out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, string>);
    // A supervised service stays up when its app crashes: what runs in it is asked of its supervisor.
    const running = new Set(rows.filter((r) => r.State === 'running').map((r) => r.Service));
    const made = await this.recipeServices(declaration);
    const supervisors = new Map(made.flatMap((s) => (s.supervisor && running.has(s.name) ? [[s.name, s.supervisor] as const] : [])));
    // A tool has no container to list: it is shown as what it is, not as a service down.
    const tools = made.filter((s) => s.tool && !rows.some((r) => r.Service === s.name)).map((s) => ({ service: s.name, state: 'tool' }));
    const programs = supervisors.size > 0 ? await this.programStates(declaration, supervisors) : [];
    const failing = programs.filter((p) => p.state === 'FATAL' || p.state === 'BACKOFF').map((p) => `${p.service}/${p.program} is ${p.state}: it keeps failing to start — octopod logs --service ${p.service}`);
    const warnings = [
      ...(await this.portWarnings(declaration)),
      ...(await this.foreignData(declaration)),
      ...(await this.foreignBinds(declaration)),
      ...(await this.rootWarnings(rows)),
      ...(await this.sharedLeftovers(declaration)),
      ...(await this.secretsDiffer(declaration)).map(
        (k) => `${k}: octopod's state and .octopod/secrets.${declaration.project}.json hold two values; the state's is used — if the data was made with the other, put it in the state (octopod secrets shows it)`,
      ),
      ...failing,
    ];
    const others = instance === 1 ? await this.instances(name) : [];
    const known = await this.knownServices(declaration, made);
    const shared = await this.sharedStates(declaration);
    return {
      ...(await this.project(declaration)),
      ...(instance > 1 ? { instance } : others.length > 0 ? { instances: others } : {}),
      services: rows
        .map((r) => {
          const own = programs.filter((p) => p.service === r.Service).map(({ program, state, detail }) => ({ program, state, detail }));
          return { service: r.Service, state: r.State, ...(r.Health ? { health: r.Health } : {}), ...(supervisors.has(r.Service) ? { programs: own } : {}) };
        })
        .concat(tools)
        .map((s) => ({ ...s, ...known.get(s.service) })),
      ...(shared.length > 0 ? { shared } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * The users of the OIDC provider a project signs in with — its own `oidc` service, or its
   * group's — through the provider's admin API, at its address at the edge, with its admin
   * token: `octopod oidc`, for an agent as for a person, whether the admin asks for the token
   * or not.
   */
  async oidcUsers(name: string, method: 'GET' | 'PUT' | 'DELETE', sub?: string, body?: unknown, instance = 1): Promise<unknown> {
    return this.oidcAdmin(name, method, `users${sub === undefined ? '' : `/${encodeURIComponent(sub)}`}`, body, instance);
  }

  /** The groups of the project's OIDC provider, as `oidcUsers` its users. */
  async oidcGroups(name: string, method: 'GET' | 'PUT' | 'DELETE', group?: string, body?: unknown, instance = 1): Promise<unknown> {
    return this.oidcAdmin(name, method, `groups${group === undefined ? '' : `/${encodeURIComponent(group)}`}`, body, instance);
  }

  /** The project's OIDC provider — its own, or its group's — where it answers, and its admin token. */
  private async oidcProvider(name: string, instance = 1): Promise<{ base: URL; token?: string; label: string }> {
    const status = await this.status(name, instance);
    const own = status.services.find((s) => s.recipe === 'oidc');
    const shared = own ? undefined : status.shared?.find((s) => s.recipe === 'oidc');
    if (!own && !shared) throw new OctopodError(`${name} has no OIDC provider (a service of recipe oidc, its own or its group's)`);
    const project = shared ? shared.stack : name;
    const service = shared ? shared.server : own!.service;
    const route = (shared ? (await this.status(project)).routes : status.routes).find((r) => r.service === service);
    if (!route) throw new OctopodError(`${project}/${service} has no route: is it up?`);
    const token = (await this.secrets(project, shared ? undefined : instance)).find((s) => s.service === service && s.name === 'admin-token')?.value;
    return { base: new URL(route.url), ...(token ? { token } : {}), label: `${project}/${service}` };
  }

  private async oidcAdmin(name: string, method: 'GET' | 'PUT' | 'DELETE' | 'POST', resource: string, body?: unknown, instance = 1): Promise<unknown> {
    const provider = await this.oidcProvider(name, instance);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const answer = await edgeRequest(new URL(`/admin/api/${resource}`, provider.base), {
      method,
      headers: { ...(provider.token ? { authorization: `Bearer ${provider.token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { body: payload } : {}),
    }).catch((e: Error) => {
      throw new OctopodError(`${provider.label}: ${e.message}`);
    });
    const parsed = (() => {
      try {
        return JSON.parse(answer.body) as { error_description?: string };
      } catch {
        return { error_description: answer.body.slice(0, 200) };
      }
    })();
    if (answer.status >= 400) throw new OctopodError(`${provider.label}: ${parsed.error_description ?? `HTTP ${answer.status}`}`);
    return parsed;
  }

  /**
   * A session of an app, signed in as a user of the project's OIDC provider (or a passing
   * identity, its claims given) with no password: the app's own sign-in, run from `start`
   * through the edge, the provider letting the user in at once. The cookies the app set.
   */
  async oidcSession(name: string, who: OidcIdentity, start: string, instance = 1): Promise<{ cookies: Cookie[]; jar: string; header: string; landed: string }> {
    const provider = await this.oidcProvider(name, instance);
    const { ticket } = (await this.oidcAdmin(name, 'POST', 'sign-in', who, instance)) as { ticket: string };
    const app = edgeUrl(start);
    const jar = new CookieJar();
    // The ticket goes with the redirect to the provider's authorize, and nowhere else.
    const { url, answer } = await follow(app, jar, (next) => {
      if (next.host === provider.base.host && next.pathname.endsWith('/authorize')) next.searchParams.set('login_ticket', ticket);
      return next;
    }).catch((e: Error) => {
      throw new OctopodError(`${start}: ${e.message}`);
    });
    if (answer.status >= 400) throw new OctopodError(`${start}: the app's sign-in ended on ${url} with ${answer.status}`);
    const own = jar.cookies.filter((c) => c.domain === app.hostname || (c.wide && app.hostname.endsWith(`.${c.domain}`)));
    return { cookies: own, jar: jar.netscape(), header: own.map((c) => `${c.name}=${c.value}`).join('; '), landed: url.toString() };
  }

  /** A link that signs a browser in as `who`, once and briefly: the provider sets its ticket, then sends it to `start`. */
  async oidcLink(name: string, who: OidcIdentity, start: string, instance = 1): Promise<{ url: string; expires_in: number }> {
    const provider = await this.oidcProvider(name, instance);
    edgeUrl(start);
    const { ticket, expires_in } = (await this.oidcAdmin(name, 'POST', 'sign-in', who, instance)) as { ticket: string; expires_in: number };
    const url = new URL('/sign-in', provider.base);
    url.searchParams.set('ticket', ticket);
    url.searchParams.set('next', start);
    return { url: url.toString(), expires_in };
  }

  /** Signed tokens for `who`, with no flow and no password grant: for an API's bearer. */
  async oidcToken(name: string, who: OidcIdentity, options: { issuer?: string; client?: string; scope?: string } = {}, instance = 1): Promise<Record<string, unknown>> {
    return (await this.oidcAdmin(
      name,
      'POST',
      'tokens',
      { ...who, ...(options.issuer ? { issuer: options.issuer } : {}), ...(options.client ? { client_id: options.client } : {}), ...(options.scope ? { scope: options.scope } : {}) },
      instance,
    )) as Record<string, unknown>;
  }

  /**
   * What runs in a service, as its recipe's `info` action reads it (the runtime, its packages,
   * its environment): the console's page of an app. The project's secrets never show in it,
   * nor the password of a URL.
   */
  async info(name: string, service: string, instance = 1): Promise<{ service: string; ok: boolean; text: string }> {
    const declaration = await this.declaration(name, instance);
    const made = (await this.recipeServices(declaration)).find((s) => s.name === service);
    const spec = made?.actions?.info;
    if (!spec) throw new OctopodError(`service "${service}" of "${name}" has no info action`);
    const result = await this.exec(name, service, spec.command, { timeoutMs: 60_000, maxBytes: 1024 * 1024, instance });
    const secrets = [...new Set((await this.secrets(name, instance).catch(() => [])).map((s) => s.value))].filter((v) => v.length >= 6);
    let text = result.output;
    for (const value of secrets) text = text.split(value).join('‹secret›');
    text = text.replace(/(\w+:\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1‹secret›@');
    return { service, ok: result.ok, text };
  }

  /**
   * The services whose main process runs as root, read where it cannot be wrong: the running
   * process itself (its uid in /proc), whatever the image's USER or the compose file's
   * `user:` said — and a database whose image starts as root and drops to its own user is
   * seen as that user. A warning, never a refusal: octopod shows, the project decides.
   */
  private async rootWarnings(rows: Record<string, string>[]): Promise<string[]> {
    const running = rows.filter((r) => r.State === 'running' && r.ID);
    if (running.length === 0 || process.platform !== 'linux') return [];
    const out = await this.docker.run(['inspect', '--format', '{{.Id}}|{{.State.Pid}}', ...running.map((r) => r.ID)]).catch(() => '');
    const warnings: string[] = [];
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const [id, pid] = line.split('|');
      const row = running.find((r) => id.startsWith(r.ID));
      const status = Number(pid) > 0 ? await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '') : '';
      const uid = /^Uid:\s+\d+\s+(\d+)/m.exec(status)?.[1];
      if (row && uid === '0') warnings.push(`${row.Service} runs as root: what it writes in the project is root's — give it a user (user: in compose, or USER in its Dockerfile)`);
    }
    return warnings;
  }

  async restart(name: string, service?: string, instance = 1): Promise<ProjectStatus> {
    const declaration = await this.declaration(name, instance);
    await this.docker.run([...this.composeArgs(declaration, true), 'restart', ...(service ? [service] : [])]);
    return this.status(name, instance);
  }

  /**
   * Run a command in a service: argv, never a shell string octopod would build. Output is
   * bounded; a command that runs past `timeoutMs` is killed.
   *
   * A service that is not running — stopped, or restarting in a loop, as an app does
   * before its dependencies are installed — cannot take an exec: the command then runs in
   * a one-off container of the service (its image, mounts, user, network), with argv as
   * the whole command as exec would, and a label that keeps the edge from routing to it.
   */
  async exec(name: string, service: string, argv: string[], options: { timeoutMs?: number; maxBytes?: number; instance?: number } = {}): Promise<ExecResult> {
    if (argv.length === 0) throw new OctopodError('exec needs a command');
    const instance = options.instance ?? 1;
    const declaration = await this.declaration(name, instance);
    const maxBytes = options.maxBytes ?? 64 * 1024;
    const bounded = (text: string): Pick<ExecResult, 'output' | 'truncated'> => ({ output: text.length > maxBytes ? text.slice(-maxBytes) : text, truncated: text.length > maxBytes });
    const attempt = async (mode: ExecResult['mode']): Promise<ExecResult> => {
      const command =
        mode === 'exec'
          ? ['exec', '-T', service, ...argv]
          : ['run', '--rm', '--no-deps', '-T', '--label', 'traefik.enable=false', '--entrypoint', argv[0], service, ...argv.slice(1)];
      try {
        const out = await this.docker.run([...this.composeArgs(declaration, true), ...command], { timeoutMs: options.timeoutMs ?? 60_000, withStderr: true });
        return { ok: true, mode, ...bounded(out) };
      } catch (e) {
        return { ok: false, mode, ...bounded((e as Error).message) };
      }
    };
    // A service in a crash loop is "running" between two restarts: its state, read first,
    // cannot be trusted. Exec when it looks up, and fall back when docker says it is not.
    const running = (await this.status(name, instance)).services.some((s) => s.service === service && s.state === 'running');
    if (!running) return attempt('run');
    const first = await attempt('exec');
    return !first.ok && NOT_RUNNING.test(first.output) ? attempt('run') : first;
  }

  /** The supervised services of a project, with their supervisor's configuration. */
  private async supervised(name: string, instance: number): Promise<{ declaration: Declaration; services: Map<string, string> }> {
    const declaration = await this.declaration(name, instance);
    return { declaration, services: await this.supervisors(declaration) };
  }

  private async supervisors(declaration: Declaration): Promise<Map<string, string>> {
    return new Map((await this.recipeServices(declaration)).flatMap((s) => (s.supervisor ? [[s.name, s.supervisor] as const] : [])));
  }

  /**
   * The built services whose image exists but was built from something else — another
   * Dockerfile, other arguments — than what the recipe now says. A missing image compose
   * builds by itself; a tool is built at each up anyway.
   */
  private async staleBuilds(declaration: Declaration): Promise<string[]> {
    const stale: string[] = [];
    for (const s of await this.recipeServices(declaration)) {
      if (!s.buildTag || s.tool) continue;
      const built = await this.docker
        .run(['image', 'inspect', `${declaration.project}-${s.name}`, '--format', `{{index .Config.Labels "${BUILD_LABEL}"}}`])
        .catch(() => undefined);
      if (built !== undefined && built.trim() !== s.buildTag) stale.push(s.name);
    }
    return stale;
  }

  /**
   * What the console shows of a recipe's service: its recipe (for its icon), and where its
   * icon leads — its route (an admin's at its `link`), or, for a database, the route of the
   * admin wired to it (phpMyAdmin for MariaDB).
   */
  private async knownServices(declaration: Declaration, made: RenderedService[]): Promise<Map<string, KnownService>> {
    const port = (await this.readJson<{ port?: number }>('edge/edge.json', {})).port ?? 80;
    const urlOf = (service: string): string | undefined => {
      const host = declaration.expose.find((e) => e.service === service)?.host;
      return host ? this.url(host, port) : undefined;
    };
    const out = new Map<string, KnownService>();
    for (const s of made) {
      const url = urlOf(s.name);
      // The project's link may be a URL of its own; a path is on the service's route.
      const link = s.link && /^https?:\/\//.test(s.link) ? s.link : url && s.link ? `${url}${s.link === '/' ? '' : s.link}` : undefined;
      out.set(s.name, {
        recipe: s.recipe,
        ...(link ? { link } : {}),
        ...(s.info ? { info: true } : {}),
        ...(s.gets ? { env: s.gets } : {}),
        ...(s.app ? { app: true } : {}),
        ...(s.app && s.uses ? { uses: s.uses } : {}),
      });
    }
    // An admin lends its address to what it administers.
    for (const s of made) {
      const url = urlOf(s.name);
      if (s.app || !url) continue;
      for (const p of s.uses ?? []) {
        const target = out.get(p);
        if (target && !target.link) {
          target.link = url;
          out.get(s.name)!.admin = p;
        }
      }
    }
    return out;
  }

  /**
   * The group's servers a project uses, under its own names, in the state the group's stack
   * has them; an admin's `admin` named as the project names what it administers.
   */
  private async sharedStates(declaration: Prepared): Promise<SharedService[]> {
    const shared = Object.entries(declaration.sharedServices ?? {});
    if (shared.length === 0 || !declaration.shareGroup) return [];
    const { project } = this.sharedOf(declaration.shareGroup);
    const stack = (await this.registry())[project] ? await this.status(project).catch(() => undefined) : undefined;
    const localOf = new Map(shared.map(([local, s]) => [s.server, local]));
    return shared.map(([local, s]) => {
      const row = stack?.services.find((x) => x.service === s.server);
      const url = stack?.routes.find((r) => r.service === s.server)?.url;
      const admin = row?.admin ? localOf.get(row.admin) : undefined;
      return {
        service: local,
        server: s.server,
        stack: project,
        ...(url ? { url } : {}),
        state: row?.state ?? 'absent',
        ...(row?.health ? { health: row.health } : {}),
        recipe: s.recipe,
        ...(row?.link ? { link: row.link } : {}),
        ...(admin ? { admin } : {}),
      };
    });
  }

  /** Whether a declaration is a group's shared services, the stack octopod made for them. */
  private isSharedStack(declaration: Declaration): boolean {
    if (!declaration.group) return false;
    const { project, dir } = this.sharedOf(declaration.group);
    return declaration.project === project && declaration.root === dir;
  }

  /**
   * A service now the group's whose former data is still in the project: said, with the way
   * over — octopod does not move a database's data on its own.
   */
  private async sharedLeftovers(declaration: Prepared): Promise<string[]> {
    const out: string[] = [];
    for (const [local, s] of Object.entries(declaration.sharedServices ?? {})) {
      const dir = join(declaration.root, DATA_DIR, `${local}-data`);
      if ((await readdir(dir).catch(() => [])).length === 0) continue;
      out.push(`${local} is group ${declaration.shareGroup}'s now (${s.server}): its former data stays in ${DATA_DIR}/${local}-data — to bring it over, run the former server from it and dump, then octopod run ${local} load`);
    }
    return out;
  }

  private async recipeServices(declaration: Declaration): Promise<RenderedService[]> {
    if (!declaration.services) return [];
    return (await this.render(declaration, false)).rendered.services;
  }

  /**
   * The programs of each supervised service — the recipe's own and the project's — as its
   * supervisor reports them. A service that is not running has none to report: it is left
   * out, and `status` says why.
   */
  async programs(name: string, instance = 1): Promise<ProgramState[]> {
    const { declaration, services } = await this.supervised(name, instance);
    return this.programStates(declaration, services);
  }

  private async programStates(declaration: Declaration, services: Map<string, string>): Promise<ProgramState[]> {
    const out: ProgramState[] = [];
    for (const [service, config] of services) {
      const report = await this.docker
        .run([...this.composeArgs(declaration, true), 'exec', '-T', service, 'supervisorctl', '-c', config, 'status'], { timeoutMs: 30_000, okExitCodes: [3] })
        .catch(() => undefined);
      for (const line of report?.split('\n') ?? []) {
        const m = /^(\S+)\s+([A-Z]+)\s*(.*)$/.exec(line.trim());
        if (m) out.push({ service, program: m[1], state: m[2], detail: m[3] });
      }
    }
    return out;
  }

  /** The actions of a project's services, the recipes' and its own. */
  async actions(name: string, instance = 1): Promise<ActionInfo[]> {
    const declaration = await this.declaration(name, instance);
    return (await this.recipeServices(declaration)).flatMap((s) =>
      Object.entries(s.actions ?? {}).map(([action, spec]) => ({
        service: s.name,
        action,
        input: spec.input,
        tty: spec.tty,
        ...(spec.summary ? { summary: spec.summary } : {}),
        ...(spec.confirm ? { confirm: spec.confirm } : {}),
      })),
    );
  }

  /**
   * The docker command that runs an action, and what it is: for the CLI, which gives it the
   * terminal or a file. In the running service; a tool's, in a one-off container.
   */
  async actionCommand(
    name: string,
    service: string,
    action: string,
    options: { instance?: number; tty?: boolean } = {},
  ): Promise<{ argv: string[]; spec: ActionInfo; env: Record<string, string> }> {
    const instance = options.instance ?? 1;
    const declaration = await this.declaration(name, instance);
    const made = (await this.recipeServices(declaration)).find((s) => s.name === service);
    const spec = made?.actions?.[action];
    if (!made || !spec) {
      const known = (await this.actions(name, instance)).filter((a) => a.service === service).map((a) => a.action);
      throw new OctopodError(`service "${service}" of "${name}" has no action "${action}"${known.length ? ` (it has ${known.join(', ')})` : ''}`);
    }
    const tty = options.tty && spec.tty ? [] : ['-T'];
    let argv: string[];
    let env: Record<string, string> = {};
    if (made.shared && declaration.shareGroup && declaration.sharedServices?.[service]) {
      // The group's server, as the project's tenant: its own account, on its own database.
      // The tenant's names and password reach the action through docker's environment
      // (`-e NAME` takes the value from it), never on a command line.
      const stack = this.sharedOf(declaration.shareGroup).project;
      const server = declaration.sharedServices[service].server;
      const state = (await this.status(stack)).services.find((s) => s.service === server)?.state;
      if (state !== 'running') throw new OctopodError(`${service} is group ${declaration.shareGroup}'s ${server}, which is ${state ?? 'not created'}: \`octopod up\` starts it`);
      env = declaration.tenancies?.find((t) => t.service === service)?.env ?? {};
      argv = ['docker', ...this.composeArgs(await this.declaration(stack), true), 'exec', ...tty, ...Object.keys(env).flatMap((k) => ['-e', k]), server, ...spec.command];
    } else if (made.tool) {
      argv = ['docker', ...this.composeArgs(declaration, true), 'run', '--rm', '--no-deps', ...tty, '--label', 'traefik.enable=false', '--entrypoint', spec.command[0], service, ...spec.command.slice(1)];
    } else {
      const state = (await this.status(name, instance)).services.find((s) => s.service === service)?.state;
      if (state !== 'running') throw new OctopodError(`${service} is ${state ?? 'not created'}: its actions run in it — \`octopod up\` starts it`);
      argv = ['docker', ...this.composeArgs(declaration, true), 'exec', ...tty, service, ...spec.command];
    }
    const info: ActionInfo = { service, action, input: spec.input, tty: spec.tty, ...(spec.summary ? { summary: spec.summary } : {}), ...(spec.confirm ? { confirm: spec.confirm } : {}) };
    return { argv, spec: info, env };
  }

  /**
   * Run an action for a client, files as its input and output (a dump written to a file, a
   * file loaded): streamed, never through memory. An interactive action is refused; one
   * that destroys needs `confirm`.
   */
  async runAction(
    name: string,
    service: string,
    action: string,
    options: { instance?: number; input?: string; output?: string; confirm?: boolean } = {},
  ): Promise<{ ok: boolean; code: number; stderr: string }> {
    const { argv, spec, env } = await this.actionCommand(name, service, action, { instance: options.instance, tty: false });
    if (spec.tty) throw new OctopodError(`${service}/${action} is interactive: \`octopod run\` in a terminal`);
    if (spec.confirm && !options.confirm) throw new OctopodError(`${service}/${action} ${spec.confirm}: confirm it`);
    if (spec.input && !options.input) throw new OctopodError(`${service}/${action} reads its input: give a file`);
    if (!this.docker.pipe) throw new OctopodError('this docker runner cannot stream');
    const result = await this.docker.pipe(argv.slice(1), { ...(spec.input ? { stdin: options.input } : {}), ...(options.output ? { stdout: options.output } : {}), env });
    return { ok: result.code === 0, ...result };
  }

  /**
   * Read a supervised service's configuration again — a file dropped, changed or removed in
   * its supervisor_d folder — and apply it: new programs started, changed ones restarted,
   * removed ones stopped; the others, the recipe's own included, left running.
   */
  async reload(name: string, service: string, instance = 1): Promise<ProgramState[]> {
    const { declaration, services } = await this.supervised(name, instance);
    const config = services.get(service);
    if (!config) throw new OctopodError(`service "${service}" of "${name}" runs no supervisor`);
    const ctl = [...this.composeArgs(declaration, true), 'exec', '-T', service, 'supervisorctl', '-c', config];
    await this.docker.run([...ctl, 'reread'], { timeoutMs: 60_000, withStderr: true });
    await this.docker.run([...ctl, 'update'], { timeoutMs: 120_000, withStderr: true });
    return (await this.programs(name, instance)).filter((p) => p.service === service);
  }

  /** Start, stop or restart one program of a supervised service. */
  async program(name: string, service: string, program: string, action: 'start' | 'stop' | 'restart', instance = 1): Promise<ProgramState[]> {
    const { declaration, services } = await this.supervised(name, instance);
    const config = services.get(service);
    if (!config) throw new OctopodError(`service "${service}" of "${name}" runs no supervisor`);
    const known = (await this.programs(name, instance)).filter((p) => p.service === service);
    if (!known.some((p) => p.program === program)) {
      throw new OctopodError(`service "${service}" has no program "${program}"${known.length ? ` (it has ${known.map((p) => p.program).join(', ')})` : ', or is not running'}`);
    }
    await this.docker.run([...this.composeArgs(declaration, true), 'exec', '-T', service, 'supervisorctl', '-c', config, action, program], { timeoutMs: 60_000, withStderr: true });
    return (await this.programs(name, instance)).filter((p) => p.service === service);
  }

  /**
   * The secrets octopod generated for a project (the `secret` params of its recipes), kept
   * in its state: for a client to mask them, never to show them. Every running instance's,
   * unless one is named — for masking, one forgotten would be a leak.
   */
  async secrets(name: string, instance?: number): Promise<Secret[]> {
    if (!(await this.names()).includes(name)) throw new OctopodError(`no project "${name}"; register it first`);
    const instances = instance !== undefined ? [instance] : [1, ...(await this.instances(name))];
    const out: Secret[] = [];
    for (const n of instances) {
      const project = instanceName(name, n);
      const kept = await this.readSecrets(project);
      for (const [service, values] of Object.entries(kept)) {
        for (const [key, value] of Object.entries(values)) out.push({ project, service, name: key, value });
      }
    }
    return out;
  }

  /** The names of the registered projects. */
  async names(): Promise<string[]> {
    return Object.keys(await this.registry());
  }

  /**
   * The docker command that opens a shell (or runs a command) in a service, as its own user
   * in its working directory — or as root. For the CLI to run on a terminal: a shell is
   * interactive, which the JSON API is not. A service that is not running is refused, with
   * the way out: `oneshot`, a fresh container of it (same image, mounts, user, network) that
   * the edge does not route to.
   */
  async shellCommand(name: string, options: ShellOptions = {}): Promise<string[]> {
    const instance = options.instance ?? 1;
    const declaration = await this.declaration(name, instance);
    const status = await this.status(name, instance);
    const service = options.service ?? declaration.expose[0]?.service ?? status.services[0]?.service;
    if (!service) throw new OctopodError(`"${declaration.project}" has no service to enter: name one`);
    const program = options.command && options.command.length > 0 ? options.command : SHELL;
    const tty = options.tty === false ? ['-T'] : [];
    const user = options.root ? ['-u', '0'] : [];
    // A tool never runs: entering it is running it.
    const tool = status.services.some((s) => s.service === service && s.state === 'tool');
    if (options.oneshot || tool) {
      return ['docker', ...this.composeArgs(declaration, true), 'run', '--rm', '--no-deps', ...tty, ...user, '--label', 'traefik.enable=false', '--entrypoint', program[0], service, ...program.slice(1)];
    }
    const state = status.services.find((s) => s.service === service)?.state;
    if (state !== 'running') {
      const known = status.services.map((s) => s.service);
      if (state === undefined && !known.includes(service) && !declaration.expose.some((e) => e.service === service)) {
        throw new OctopodError(`"${declaration.project}" has no service "${service}"${known.length > 0 ? ` (it has ${known.join(', ')})` : ''}`);
      }
      throw new OctopodError(
        `${service} is ${state ?? 'not created'}: nothing to enter. ` +
          `\`octopod up\` starts it; \`--oneshot\` opens a shell in a fresh container of it instead (same image, mounts and user).`,
      );
    }
    return ['docker', ...this.composeArgs(declaration, true), 'exec', ...tty, ...user, service, ...program];
  }

  async logs(name: string, service: string | undefined, tail: number, instance = 1): Promise<string[]> {
    const declaration = await this.declaration(name, instance);
    const out = await this.docker.run([...this.composeArgs(declaration, false), 'logs', '--no-color', '--tail', String(tail), ...(service ? [service] : [])]);
    return out.split('\n').filter((l) => l !== '');
  }

  /**
   * What is wrong on this machine, and how to put it right: Docker, the edge, the console,
   * the API, the state directory's modes, projects whose folder is gone, secrets whose two
   * copies differ. Reads only.
   */
  async doctor(): Promise<{ checks: DoctorCheck[] }> {
    const checks: DoctorCheck[] = [];
    const add = (name: string, ok: boolean, detail: string, fix: string): void => {
      checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });
    };
    const answer = (args: string[]) => this.docker.run(args).then((s) => s.trim(), () => undefined);
    const server = await answer(['version', '--format', '{{.Server.Version}}']);
    add('docker', !!server, server ? `Docker ${server}` : 'the daemon does not answer', 'start Docker, and check that your user may use it: docker version');
    const compose = server ? await answer(['compose', 'version', '--short']) : undefined;
    add('compose', !!compose, compose ? `Compose ${compose}` : 'docker compose does not answer', 'install Docker Compose v2 (the docker compose plugin)');
    if (server) {
      const [os = '', security = ''] = ((await answer(['info', '--format', '{{.OperatingSystem}}|{{json .SecurityOptions}}'])) ?? '').split('|');
      const rootless = security.includes('rootless');
      add('platform', true, `${process.platform}, ${os || 'Docker'}${rootless ? ', rootless: port 80 needs net.ipv4.ip_unprivileged_port_start, 8480 is used otherwise' : ''}`, '');
    }
    const edge = await this.edgeStatus();
    add('edge', edge.running, edge.running ? `on 127.0.0.1:${edge.port}` : 'not running', 'octopod edge up');
    if (!this.tcp) {
      const relay = await answer(['inspect', '--format', '{{.State.Running}}', consoleContainer(this.instance)]);
      add('console', relay === 'true', relay === 'true' ? `the relay runs (${edge.console ?? 'http://octopod.localhost'})` : 'the relay is not running', 'octopod edge up');
    }
    const target = this.tcp ? { host: '127.0.0.1', port: (await this.readJson<Partial<ApiTcp>>('api.json', {})).port ?? 0 } : { path: this.socket };
    const serving = await reachable(target);
    add('api', serving, serving ? `served (${this.tcp ? `127.0.0.1:${target.port}` : this.socket})` : 'not served: the console has no data', process.platform === 'linux' ? 'systemctl --user start octopod, or octopod serve' : 'octopod serve');
    if (process.platform !== 'win32') {
      const open: string[] = [];
      for (const file of [this.path('console-access.json'), this.path('api.json'), ...(await this.names()).map((n) => this.path('projects', n, 'secrets.json'))]) {
        const mode = await stat(file).then((s) => s.mode & 0o077, () => 0);
        if (mode) open.push(file);
      }
      add('state', open.length === 0, open.length === 0 ? `${this.stateDir}: secrets readable by you alone` : `readable by others: ${open.join(', ')}`, `chmod 600 ${open.join(' ')}`);
    }
    const registry = await this.registry();
    const gone: string[] = [];
    for (const [name, root] of Object.entries(registry)) {
      if (!(await stat(join(root, DECLARATION_FILE)).then(() => true, () => false))) gone.push(name);
    }
    add('projects', gone.length === 0, gone.length === 0 ? `${Object.keys(registry).length} registered, each folder in place` : `no ${DECLARATION_FILE} any more for ${gone.join(', ')}`, gone.map((n) => `octopod unregister ${n}`).join('; '));
    const differ: string[] = [];
    for (const [name, root] of Object.entries(registry)) {
      if (gone.includes(name)) continue;
      const declared = await loadDeclaration(root).catch(() => undefined);
      if (declared && (await this.secretsDiffer(declared)).length > 0) differ.push(name);
    }
    add(
      'secrets',
      differ.length === 0,
      differ.length === 0 ? "each project's copy of its secrets agrees with octopod's" : `octopod's state and the project's .octopod/secrets.<project>.json differ for ${differ.join(', ')}`,
      `octopod status ${differ[0] ?? ''} says which; the state's are used: a database made with the other values refuses them`,
    );
    return { checks };
  }

  /** Every registered project down, each of its instances too, the data left in place: for `uninstall`. */
  async stopAll(): Promise<string[]> {
    const stopped: string[] = [];
    for (const name of await this.names()) {
      for (const n of [...(await this.instances(name)), 1]) {
        await this.down(name, { instance: n }).catch(() => undefined);
        stopped.push(instanceName(name, n));
      }
    }
    return stopped;
  }

  async unregister(name: string): Promise<void> {
    for (const n of [...(await this.instances(name)), 1]) {
      await this.down(name, { instance: n, images: true }).catch(() => undefined);
      await this.forgetDataVolumes(name, n);
    }
    const registry = await this.registry();
    const root = registry[name];
    delete registry[name];
    await this.writeJson('projects.json', registry);
    // The data in .octopod/data stays, and with it the secrets it was made with: a database
    // kept there opens with them only — registered again, the project finds them.
    await rm(this.path('edge', 'dynamic', `from-${name}.yml`), { force: true });
    const dir = this.path('projects', name);
    const data = root ? await stat(join(root, DATA_DIR)).catch(() => undefined) : undefined;
    if (!data) return rm(dir, { recursive: true, force: true });
    for (const entry of await readdir(dir).catch(() => [])) {
      if (entry !== 'secrets.json') await rm(join(dir, entry), { recursive: true, force: true });
    }
  }
}
