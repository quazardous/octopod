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
export function dataVolumes(root: string, volumes: Record<string, ComposeVolume>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, volume] of Object.entries(volumes)) {
    if (volume.external) continue;
    if (volume.driver && volume.driver !== 'local') continue;
    if (volume.driver_opts && Object.keys(volume.driver_opts).length > 0) continue;
    out[key] = `${root}/${DATA_DIR}/${key}`;
  }
  return out;
}

/** A service of the project as `docker compose config` sees it: only what the override needs. */
export interface ComposeService {
  networks?: Record<string, unknown> | string[];
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
        [`traefik.http.services.${id}.loadbalancer.server.port`]: String(exposure.port),
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
