/**
 * The edge and the projects on it.
 *
 * State lives under `$XDG_STATE_HOME/octopod/` (or `stateDir`): the edge's port and files,
 * the registry of projects, each project's generated override. Nothing is written into a
 * project.
 */
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadDeclaration, type Declaration } from './declaration.js';
import { cliDocker, DockerError, type Docker } from './docker.js';
import { DATA_DIR, dataVolumes, edgeCompose, edgeContainer, projectOverride, traefikConfig, type ComposeService, type ComposeVolume } from './generate.js';
import { edgeNetwork } from './names.js';

export const PREFERRED_PORT = 80;
export const FALLBACK_PORT = 8480;

export interface Route {
  service: string;
  url: string;
}

export interface Project {
  name: string;
  root: string;
  /** The compose files used, in order: what the project declared, or found (main, then override). */
  compose: string[];
  routes: Route[];
}

export interface ProjectStatus extends Project {
  services: { service: string; state: string; health?: string }[];
  /** Things the operator should fix, e.g. data written by a service that runs as another user. */
  warnings?: string[];
}

export interface ExecResult {
  ok: boolean;
  /** Output (or the error), the end of it when longer than the bound. */
  output: string;
  truncated: boolean;
}

export interface EdgeStatus {
  running: boolean;
  port: number | null;
  dashboard: string | null;
}

export interface OctopodOptions {
  stateDir?: string;
  /** Prefix of every name octopod creates in Docker; tests use their own. */
  instance?: string;
  docker?: Docker;
  /** Ports to try for the edge, in order. */
  ports?: number[];
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

  constructor(options: OctopodOptions = {}) {
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
    return { running, port: running ? port : null, dashboard: running && port ? this.url('traefik.localhost', port) : null };
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
    const configFile = this.path('edge', 'traefik.yml');
    await this.writeJson('edge/traefik.yml', traefikConfig());
    await this.writeJson('edge/compose.json', edgeCompose({ instance: this.instance, port, configFile }));
    if (!(await this.edgeRunning())) {
      await this.docker.run(['compose', '-f', this.path('edge', 'compose.json'), 'up', '-d']);
    }
    // After a restart the edge has lost its project networks: connect it to each again.
    for (const name of Object.keys(await this.registry())) await this.connect(name);
    return this.edgeStatus();
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

  private async declaration(name: string): Promise<Declaration> {
    const root = (await this.registry())[name];
    if (!root) throw new OctopodError(`no project "${name}"; register it first`);
    return loadDeclaration(root);
  }

  private async routes(declaration: Declaration): Promise<Route[]> {
    const port = await this.edgePort({ choose: false });
    return declaration.expose.map((e) => ({ service: e.service, url: this.url(e.host, port) }));
  }

  private async project(declaration: Declaration): Promise<Project> {
    return { name: declaration.project, root: declaration.root, compose: declaration.compose, routes: await this.routes(declaration) };
  }

  async register(root: string): Promise<Project> {
    const declaration = await loadDeclaration(root);
    const registry = await this.registry();
    const owner = registry[declaration.project];
    if (owner && owner !== root) throw new OctopodError(`project "${declaration.project}" is already registered from ${owner}`);
    registry[declaration.project] = root;
    await this.writeJson('projects.json', registry);
    return this.project(declaration);
  }

  async list(): Promise<Project[]> {
    const out: Project[] = [];
    for (const name of Object.keys(await this.registry())) out.push(await this.project(await this.declaration(name)));
    return out;
  }

  private composeArgs(declaration: Declaration, withOverride: boolean): string[] {
    const files = declaration.compose.flatMap((f) => ['-f', f]);
    const override = withOverride ? ['-f', this.path('projects', declaration.project, 'override.json')] : [];
    return ['compose', '-p', declaration.project, '--project-directory', declaration.root, ...files, ...override];
  }

  async up(name: string): Promise<ProjectStatus> {
    const declaration = await this.declaration(name);
    const config = JSON.parse(await this.docker.run([...this.composeArgs(declaration, false), 'config', '--format', 'json'])) as {
      services?: Record<string, ComposeService>;
      volumes?: Record<string, ComposeVolume>;
    };
    const data = dataVolumes(declaration.root, config.volumes ?? {});
    await this.prepareData(declaration, config.volumes ?? {}, data);
    const override = projectOverride(this.instance, declaration, config.services ?? {}, data);
    await this.writeJson(join('projects', declaration.project, 'override.json'), override);
    await this.edgeUp();
    await this.docker.run([...this.composeArgs(declaration, true), 'up', '-d']);
    await this.connect(declaration.project);
    return this.status(name);
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

  async down(name: string, options: { volumes?: boolean } = {}): Promise<ProjectStatus> {
    const declaration = await this.declaration(name);
    // Before `down`: compose cannot remove a network the edge is still attached to.
    await this.disconnect(declaration.project);
    await this.docker.run([...this.composeArgs(declaration, true), 'down', ...(options.volumes ? ['--volumes'] : [])]);
    return this.status(name);
  }

  async status(name: string): Promise<ProjectStatus> {
    const declaration = await this.declaration(name);
    const out = await this.docker.run([...this.composeArgs(declaration, false), 'ps', '--all', '--format', 'json']).catch((e: DockerError) => {
      throw new OctopodError(e.message);
    });
    // One JSON object per line (compose v2+), or an array (older versions).
    const rows = out.trim().startsWith('[')
      ? (JSON.parse(out) as Record<string, string>[])
      : out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, string>);
    const warnings = await this.foreignData(declaration);
    return {
      ...(await this.project(declaration)),
      services: rows.map((r) => ({ service: r.Service, state: r.State, ...(r.Health ? { health: r.Health } : {}) })),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async restart(name: string, service?: string): Promise<ProjectStatus> {
    const declaration = await this.declaration(name);
    await this.docker.run([...this.composeArgs(declaration, true), 'restart', ...(service ? [service] : [])]);
    return this.status(name);
  }

  /**
   * Run a command in a running service: argv, never a shell string octopod would build.
   * Output is bounded; a command that runs past `timeoutMs` is killed.
   */
  async exec(name: string, service: string, argv: string[], options: { timeoutMs?: number; maxBytes?: number } = {}): Promise<ExecResult> {
    if (argv.length === 0) throw new OctopodError('exec needs a command');
    const declaration = await this.declaration(name);
    const maxBytes = options.maxBytes ?? 64 * 1024;
    try {
      const out = await this.docker.run([...this.composeArgs(declaration, true), 'exec', '-T', service, ...argv], {
        timeoutMs: options.timeoutMs ?? 60_000,
        withStderr: true,
      });
      return { ok: true, output: out.length > maxBytes ? out.slice(-maxBytes) : out, truncated: out.length > maxBytes };
    } catch (e) {
      const message = (e as Error).message;
      return { ok: false, output: message.length > maxBytes ? message.slice(-maxBytes) : message, truncated: message.length > maxBytes };
    }
  }

  async logs(name: string, service: string | undefined, tail: number): Promise<string[]> {
    const declaration = await this.declaration(name);
    const out = await this.docker.run([...this.composeArgs(declaration, false), 'logs', '--no-color', '--tail', String(tail), ...(service ? [service] : [])]);
    return out.split('\n').filter((l) => l !== '');
  }

  async unregister(name: string): Promise<void> {
    await this.down(name).catch(() => undefined);
    const registry = await this.registry();
    delete registry[name];
    await this.writeJson('projects.json', registry);
    await rm(this.path('projects', name), { recursive: true, force: true });
  }
}
