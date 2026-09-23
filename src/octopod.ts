/**
 * The edge and the projects on it.
 *
 * State lives under `$XDG_STATE_HOME/octopod/` (or `stateDir`): the edge's port and files,
 * the registry of projects, each project's generated override. Nothing is written into a
 * project.
 */
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadDeclaration, withInstance, type Declaration } from './declaration.js';
import { lintDockerfile } from './recipes/lint.js';
import { BUILTIN_RECIPES, envRecipeDirs, loadRecipes, type Shadowed } from './recipes/loader.js';
import { formatPlan, renderServices, type RenderedService } from './recipes/render.js';
import { cliDocker, DockerError, type Docker } from './docker.js';
import { choosePort, composePorts, CONSOLE_HOST, consoleNginxConfig, DASHBOARD_HOST, DATA_DIR, dataVolumes, duplicationBlockers, edgeCompose, edgeContainer, imagePorts, localOnlyConfig, projectOverride, traefikConfig, type ComposeService, type ComposeVolume, type ResolvedPort } from './generate.js';
import { edgeNetwork, fullHost, instanceName } from './names.js';

/** The version of the contract in docs/CONTRACT.md: the declaration, the API, the CLI's JSON. */
export const CONTRACT = 1;

/** octopod's own version, from its package.json — the same file from the sources and from dist/. */
/**
 * What this octopod adds to contract 1, by name: a client checks for the feature it needs,
 * since an older octopod speaks contract 1 too without it. Absent before 0.2.0: none.
 */
export const FEATURES = ['secrets'];

export async function version(): Promise<{ version: string; contract: number; features: string[] }> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return { version: pkg.version, contract: CONTRACT, features: FEATURES };
}

/** A secret octopod generated for a project's recipe: where it belongs, and its value. */
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
}

export interface ProjectStatus extends Project {
  /** This status is of instance N (`<project>-N`). */
  instance?: number;
  /** The project's other instances up, when this is the first. */
  instances?: number[];
  /** `programs`: a supervised service's, as its supervisor reports them, when it runs. */
  services: { service: string; state: string; health?: string; programs?: { program: string; state: string; detail: string }[] }[];
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

export interface OctopodOptions {
  stateDir?: string;
  /** Prefix of every name octopod creates in Docker; tests use their own. */
  instance?: string;
  docker?: Docker;
  /** Ports to try for the edge, in order. */
  ports?: number[];
  /** The API's unix socket, which the console relays to. */
  socket?: string;
}

/** Where `octopod serve` listens, and the console finds it. */
export function defaultSocket(): string {
  return join(process.env.XDG_RUNTIME_DIR || join(tmpdir(), `octopod-${process.getuid?.() ?? 'user'}`), 'octopod', 'octopod.sock');
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

export class Octopod {
  readonly stateDir: string;
  readonly instance: string;
  private readonly docker: Docker;
  private readonly ports: number[];
  readonly socket: string;

  constructor(options: OctopodOptions = {}) {
    this.socket = options.socket ?? defaultSocket();
    this.stateDir = options.stateDir ?? defaultStateDir();
    this.instance = options.instance ?? process.env.OCTOPOD_INSTANCE ?? 'octopod';
    this.docker = options.docker ?? cliDocker();
    this.ports = options.ports ?? envPorts() ?? [PREFERRED_PORT, FALLBACK_PORT];
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
    await mkdir(join(this.path(file), '..'), { recursive: true });
    await writeFile(this.path(file), JSON.stringify(value, null, 2) + '\n');
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
    const socketDir = dirname(this.socket);
    await mkdir(socketDir, { recursive: true, mode: 0o700 });
    await chmod(socketDir, 0o700);
    const traefik = JSON.stringify(traefikConfig(this.instance), null, 2) + '\n';
    const nginx = consoleNginxConfig(basename(this.socket));
    await mkdir(this.path('edge', 'dynamic'), { recursive: true });
    await writeFile(this.path('edge', 'traefik.yml'), traefik);
    await writeFile(this.path('edge', 'console.conf'), nginx);
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
    await this.docker.run(['compose', '-f', this.path('edge', 'compose.json'), 'up', '-d', '--remove-orphans']);
    await this.writeLocalOnly();
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
   * Traefik watches the folder.
   */
  private async writeLocalOnly(): Promise<void> {
    const network = `${this.instance}-edge_default`;
    const out = await this.docker.run(['network', 'inspect', network, '--format', '{{json .IPAM.Config}}']);
    const subnets = ((JSON.parse(out.trim() || 'null') ?? []) as { Subnet?: string }[]).map((c) => c.Subnet).filter((s): s is string => !!s);
    if (subnets.length === 0) throw new OctopodError(`network ${network} has no subnet: the console and the dashboard stay closed`);
    const file = this.path('edge', 'dynamic', 'local.yml');
    await writeFile(`${file}.tmp`, JSON.stringify(localOnlyConfig(subnets), null, 2) + '\n');
    await rename(`${file}.tmp`, file);
  }

  async edgeDown(): Promise<EdgeStatus> {
    await this.docker.run(['compose', '-f', this.path('edge', 'compose.json'), 'down']).catch(() => '');
    return this.edgeStatus();
  }

  private async connect(project: string): Promise<void> {
    const network = edgeNetwork(this.instance, project);
    const exists = await this.docker.run(['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}']).catch(() => '');
    if (exists.trim() !== network) return;
    await this.docker.run(['network', 'connect', network, edgeContainer(this.instance)]).catch((e: Error) => {
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
  private async declaration(name: string, instance = 1): Promise<Declaration> {
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
    const secretsFile = join('projects', declaration.project, 'secrets.json');
    const kept = keepSecrets ? await this.readJson<Record<string, Record<string, string>>>(secretsFile, {}) : {};
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
  private async withRecipes(declaration: Declaration, write: boolean): Promise<Declaration> {
    if (!declaration.services) return declaration;
    const { rendered } = await this.render(declaration, write);
    const dir = join(declaration.root, '.octopod');
    const composeFile = join(dir, `recipes.${declaration.project}.json`);
    if (write) {
      await this.writeSecret(join('projects', declaration.project, 'secrets.json'), rendered.secrets);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined);
      await writeFile(composeFile, JSON.stringify(rendered.compose, null, 2) + '\n');
      for (const [path, content] of Object.entries(rendered.files)) {
        await mkdir(join(declaration.root, dirname(path)), { recursive: true });
        await writeFile(join(declaration.root, path), content);
      }
    }
    const declared = new Set(declaration.expose.map((e) => e.service));
    const expose = [...declaration.expose];
    for (const service of rendered.services) {
      if (service.route === undefined || declared.has(service.name)) continue;
      const host = fullHost(declaration.project, service.route || undefined);
      const taken = expose.find((e) => e.host === host);
      if (taken) throw new OctopodError(`services ${taken.service} and ${service.name} both want ${host}: expose one of them under a host of its own`);
      expose.push({ service: service.name, host });
    }
    const profiles = [...new Set(Object.values(rendered.compose.services).flatMap((svc) => (svc.profiles as string[] | undefined) ?? []))];
    return { ...declaration, compose: [composeFile, ...declaration.compose], expose, ...(profiles.length > 0 ? { profiles } : {}) };
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
    const { rendered } = await this.render(declaration, false);
    return {
      project: declaration.project,
      text: formatPlan(declaration.project, rendered.services, declaration.workspace ?? declaration.root),
      services: rendered.services,
      compose: rendered.compose,
    };
  }

  private async writeSecret(file: string, value: unknown): Promise<void> {
    await mkdir(join(this.path(file), '..'), { recursive: true });
    await writeFile(this.path(file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
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
        if (!filtered) out.push({ name, root, compose: [], routes: [], problem: (e as Error).message });
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

  async up(name: string, instance = 1): Promise<ProjectStatus> {
    const declaration = await this.declaration(name, instance);
    const config = JSON.parse(await this.docker.run([...this.composeArgs(declaration, false), 'config', '--format', 'json'])) as {
      services?: Record<string, ComposeService>;
      volumes?: Record<string, ComposeVolume>;
    };
    if (instance > 1) {
      const blockers = duplicationBlockers(config.services ?? {});
      if (blockers.length > 0) throw new OctopodError(`"${name}" cannot run twice: ${blockers.join('; ')}`);
    }
    const data = dataVolumes(declaration.root, config.volumes ?? {}, instance);
    await this.prepareData(declaration, config.volumes ?? {}, data);
    const ports = await this.resolvePorts(declaration, config.services ?? {});
    await this.writeJson(join('projects', declaration.project, 'ports.json'), ports);
    const override = projectOverride(this.instance, declaration, config.services ?? {}, data, Object.fromEntries(Object.entries(ports).map(([h, r]) => [h, r.port])));
    await this.writeJson(join('projects', declaration.project, 'override.json'), override);
    await this.edgeUp();
    await this.docker.run([...this.composeArgs(declaration, true), 'up', '-d']);
    await this.connect(declaration.project);
    if (instance > 1) await this.noteInstance(name, instance, true);
    return this.status(name, instance);
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
      .run([...this.composeArgs(declaration, false), 'config', '--format', 'json'])
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

  async down(name: string, options: { volumes?: boolean; instance?: number; images?: boolean } = {}): Promise<ProjectStatus> {
    const instance = options.instance ?? 1;
    const declaration = await this.declaration(name, instance);
    // Before `down`: compose cannot remove a network the edge is still attached to.
    await this.disconnect(declaration.project);
    // `--rmi local`: the images compose built for the project (recipes that build), never a pulled one.
    await this.docker.run([...this.composeArgs(declaration, true), 'down', ...(options.volumes ? ['--volumes'] : []), ...(options.images ? ['--rmi', 'local'] : [])]);
    if (instance > 1) await this.noteInstance(name, instance, false);
    return this.status(name, instance);
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
    const supervisors = new Map([...(await this.supervisors(declaration))].filter(([service]) => running.has(service)));
    const programs = supervisors.size > 0 ? await this.programStates(declaration, supervisors) : [];
    const failing = programs.filter((p) => p.state === 'FATAL' || p.state === 'BACKOFF').map((p) => `${p.service}/${p.program} is ${p.state}: it keeps failing to start — octopod logs --service ${p.service}`);
    const warnings = [...(await this.portWarnings(declaration)), ...(await this.foreignData(declaration)), ...(await this.rootWarnings(rows)), ...failing];
    const others = instance === 1 ? await this.instances(name) : [];
    return {
      ...(await this.project(declaration)),
      ...(instance > 1 ? { instance } : others.length > 0 ? { instances: others } : {}),
      services: rows.map((r) => {
        const own = programs.filter((p) => p.service === r.Service).map(({ program, state, detail }) => ({ program, state, detail }));
        return { service: r.Service, state: r.State, ...(r.Health ? { health: r.Health } : {}), ...(supervisors.has(r.Service) ? { programs: own } : {}) };
      }),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
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
    if (!declaration.services) return new Map();
    const { rendered } = await this.render(declaration, false);
    return new Map(rendered.services.flatMap((s) => (s.supervisor ? [[s.name, s.supervisor] as const] : [])));
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
      const kept = await this.readJson<Record<string, Record<string, string>>>(join('projects', project, 'secrets.json'), {});
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
    if (options.oneshot) {
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

  async unregister(name: string): Promise<void> {
    for (const n of [...(await this.instances(name)), 1]) {
      await this.down(name, { instance: n, images: true }).catch(() => undefined);
      await this.forgetDataVolumes(name, n);
    }
    const registry = await this.registry();
    delete registry[name];
    await this.writeJson('projects.json', registry);
    await rm(this.path('projects', name), { recursive: true, force: true });
  }
}
