/**
 * What octopod writes: the shared Traefik's static configuration and compose file, and a
 * project's compose override. Pure functions of their inputs — tested without Docker.
 */
import { edgeNetwork } from './names.js';
import type { Declaration } from './declaration.js';

export const TRAEFIK_IMAGE = 'traefik:v3.6.1';
/** The only label the shared Traefik considers: everything else on the machine is invisible to it. */
export const EDGE_LABEL = 'octopod.edge';

export interface EdgeSettings {
  instance: string;
  port: number;
  /** Where the Traefik static configuration file lives on the host. */
  configFile: string;
}

export function edgeContainer(instance: string): string {
  return `${instance}-edge`;
}

export function traefikConfig(): Record<string, unknown> {
  return {
    entryPoints: { web: { address: ':80' } },
    api: { dashboard: true },
    providers: {
      docker: {
        exposedByDefault: false,
        // An exact value: the Docker socket shows every container on the machine, and
        // many carry traefik.enable=true for their own Traefik.
        constraints: `Label(\`${EDGE_LABEL}\`, \`1\`)`,
        watch: true,
      },
    },
    log: { level: 'INFO' },
    accessLog: {},
  };
}

export function edgeCompose(settings: EdgeSettings): Record<string, unknown> {
  return {
    name: `${settings.instance}-edge`,
    services: {
      traefik: {
        image: TRAEFIK_IMAGE,
        container_name: edgeContainer(settings.instance),
        restart: 'unless-stopped',
        ports: [`127.0.0.1:${settings.port}:80`],
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', `${settings.configFile}:/etc/traefik/traefik.yml:ro`],
        labels: {
          [EDGE_LABEL]: '1',
          'traefik.enable': 'true',
          'traefik.http.routers.octopod-dashboard.rule': 'Host(`traefik.localhost`)',
          'traefik.http.routers.octopod-dashboard.entrypoints': 'web',
          'traefik.http.routers.octopod-dashboard.service': 'api@internal',
        },
      },
    },
  };
}

/**
 * Where a project's data lives: in the project, never in Docker's own storage. octopod is
 * an infrastructure provider; the data is the project's, and moves, is backed up and is
 * deleted with it.
 */
export const DATA_DIR = '.octopod/data';

/** A top-level volume as `docker compose config` sees it. */
export interface ComposeVolume {
  name?: string;
  external?: unknown;
  driver?: string;
  driver_opts?: Record<string, string>;
}

/**
 * The project's own named volumes, each with the folder it is bound to. A volume the
 * project configured itself — external, another driver, its own options — is left alone.
 */
export function dataVolumes(root: string, volumes: Record<string, ComposeVolume>, instance = 1): Record<string, string> {
  // Instance N keeps its own data beside the first's: .octopod/data/N/<volume>.
  const dir = instance === 1 ? `${root}/${DATA_DIR}` : `${root}/${DATA_DIR}/${instance}`;
  const out: Record<string, string> = {};
  for (const [key, volume] of Object.entries(volumes)) {
    if (volume.external) continue;
    if (volume.driver && volume.driver !== 'local') continue;
    if (volume.driver_opts && Object.keys(volume.driver_opts).length > 0) continue;
    out[key] = `${dir}/${key}`;
  }
  return out;
}

/** A service of the project as `docker compose config` sees it: only what octopod needs. */
export interface ComposeService {
  networks?: Record<string, unknown> | string[];
  image?: string;
  build?: unknown;
  expose?: (string | number)[];
  ports?: ({ target?: number; protocol?: string } | string | number)[];
}

export type PortSource = 'declared' | 'compose' | 'image' | 'guess';

export interface ResolvedPort {
  port: number;
  source: PortSource;
  /** Every port that source offered, when there was a choice. */
  candidates: number[];
}

/** The ports web servers listen on most, best first: the pick when a service offers several. */
const LIKELY = [80, 8080, 3000, 8000, 5173, 4200, 5000, 8888, 9000];
/** Nothing known at all: route to the usual one rather than refuse — a 502 says the rest. */
const GUESS = 80;

function number(value: string | number | undefined): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').split(/[/-]/)[0]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

/** The TCP ports a compose service says it listens on: `expose`, then the targets of `ports`. */
export function composePorts(service: ComposeService): number[] {
  const out = new Set<number>();
  for (const e of service.expose ?? []) {
    if (!String(e).endsWith('/udp')) {
      const n = number(e);
      if (n) out.add(n);
    }
  }
  for (const p of service.ports ?? []) {
    if (typeof p === 'object') {
      if (p.protocol !== 'udp' && p.target) out.add(p.target);
    } else {
      // "8080:80" or "80": the container side is the last number.
      const n = number(String(p).split(':').pop());
      if (n && !String(p).endsWith('/udp')) out.add(n);
    }
  }
  return [...out];
}

/** The TCP ports of an image's EXPOSE, from `docker image inspect` (`{"80/tcp": {}}`). */
export function imagePorts(exposed: Record<string, unknown> | null | undefined): number[] {
  return Object.keys(exposed ?? {}).filter((k) => !k.endsWith('/udp')).map((k) => number(k)).filter((n): n is number => n !== undefined);
}

/**
 * The port to route to: declared, else the compose file's, else the image's, else a guess.
 * Never a refusal — a development edge that will not start is worse than a wrong port —
 * and when a source offers several, the likeliest web port, then the lowest.
 */
export function choosePort(declared: number | undefined, compose: number[], image: number[]): ResolvedPort {
  if (declared !== undefined) return { port: declared, source: 'declared', candidates: [] };
  const pick = (ports: number[]): number => LIKELY.find((p) => ports.includes(p)) ?? [...ports].sort((a, b) => a - b)[0];
  if (compose.length > 0) return { port: pick(compose), source: 'compose', candidates: compose.length > 1 ? compose : [] };
  if (image.length > 0) return { port: pick(image), source: 'image', candidates: image.length > 1 ? image : [] };
  return { port: GUESS, source: 'guess', candidates: [] };
}

/**
 * The override: for each exposed service, the routing labels and the project's edge
 * network. A service that relied on the implicit default network keeps it — listing any
 * network would otherwise drop it.
 */
export function projectOverride(
  instance: string,
  declaration: Declaration,
  services: Record<string, ComposeService>,
  /** From `dataVolumes`: each named volume becomes a bind to its folder in the project. */
  data: Record<string, string> = {},
  /** The port of each exposure, by host; an exposure's declared port otherwise. */
  ports: Record<string, number> = {},
): Record<string, unknown> {
  const network = edgeNetwork(instance, declaration.project);
  const out: Record<string, unknown> = {};
  for (const exposure of declaration.expose) {
    const current = services[exposure.service];
    if (!current) throw new Error(`service "${exposure.service}" is not in ${declaration.compose.join(', ')}`);
    // One router and one Traefik service per exposure: a compose service may be exposed
    // under several hosts, on several ports.
    const id = `${declaration.project}-${exposure.host.slice(0, -'.localhost'.length).replace(/\./g, '-')}`;
    const existing = current.networks === undefined ? ['default'] : Array.isArray(current.networks) ? current.networks : Object.keys(current.networks);
    const previous = out[exposure.service] as { labels: Record<string, string> } | undefined;
    out[exposure.service] = {
      labels: {
        ...previous?.labels,
        [EDGE_LABEL]: '1',
        'octopod.project': declaration.project,
        'traefik.enable': 'true',
        'traefik.docker.network': network,
        [`traefik.http.routers.${id}.rule`]: `Host(\`${exposure.host}\`)`,
        [`traefik.http.routers.${id}.entrypoints`]: 'web',
        [`traefik.http.routers.${id}.service`]: id,
        [`traefik.http.services.${id}.loadbalancer.server.port`]: String(ports[exposure.host] ?? exposure.port ?? GUESS),
      },
      networks: Object.fromEntries([...existing.map((n) => [n, {}]), ['octopod_edge', {}]]),
    };
  }
  // `internal`: Traefik reaches the project's containers over it, and nothing else does —
  // the edge network must not become a way out to the internet for a project that has no
  // egress of its own.
  const volumes = Object.fromEntries(
    Object.entries(data).map(([key, device]) => [key, { driver: 'local', driver_opts: { type: 'none', o: 'bind', device } }]),
  );
  return {
    services: out,
    networks: { octopod_edge: { name: network, internal: true } },
    ...(Object.keys(volumes).length > 0 ? { volumes } : {}),
  };
}

/**
 * What stops a project from running twice: a fixed container name, or a fixed port
 * published on the host — the second instance would collide with the first.
 */
export function duplicationBlockers(services: Record<string, ComposeService & { container_name?: string }>): string[] {
  const out: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    if (service.container_name) out.push(`${name}: container_name "${service.container_name}" is fixed`);
    for (const p of service.ports ?? []) {
      const published = typeof p === 'object' ? (p as { published?: string | number }).published : String(p).split(':').length > 1 ? String(p) : undefined;
      if (published !== undefined && published !== '') out.push(`${name}: publishes a fixed host port (${typeof p === 'object' ? published : p})`);
    }
  }
  return out;
}
