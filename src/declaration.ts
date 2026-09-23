/**
 * `octopod.yaml`: what a project exposes. The project keeps its own compose files; this
 * only says which services the edge routes to, on which port, under which host.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ActionSchema, type ActionSpec } from './recipes/recipe.js';
import { fullHost, instanceName, LABEL_RE, RESERVED_PROJECTS, slugify } from './names.js';

export const DECLARATION_FILE = 'octopod.yaml';
const DEFAULT_COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

/**
 * A program a supervised service runs beside its own (a worker, a task started by hand):
 * one line, split by supervisord, no shell. No line break, which would end the entry.
 */
const Program = z
  .object({
    command: z.string().min(1).max(1_000).regex(/^[^\r\n]*$/, 'one line'),
    /** Started with the container; false: started by hand (`octopod program start`). */
    autostart: z.boolean().default(true),
  })
  .strict();

export interface ProgramSpec {
  command: string;
  autostart: boolean;
}

const Schema = z
  .object({
    project: z.string().regex(LABEL_RE, 'must be a DNS label: a-z, 0-9 and -, at most 63').optional(),
    compose: z.array(z.string().min(1).max(200)).min(1).optional(),
    /** Variables for the compose files' interpolation, relative to the project; compose's own `.env` otherwise. */
    env_file: z.string().min(1).max(200).optional(),
    expose: z
      .array(
        z
          .object({
            service: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
            port: z.number().int().min(1).max(65535).optional(),
            host: z.string().max(200).optional(),
          })
          .strict(),
      )
      .default([]),
    /** Services made of recipes: `app: { recipe: node-app }`, `db: { recipe: postgres, persist: true }`. */
    services: z
      .record(z.string(), z.object({ recipe: z.string().min(1).max(64), programs: z.record(z.string(), Program).optional(), supervisor_d: z.string().min(1).max(400).optional(), actions: z.record(z.string(), ActionSchema).optional(), home: z.union([z.literal(true), z.string().min(1).max(400)]).optional(), workdir: z.string().regex(/^\/[A-Za-z0-9._-][A-Za-z0-9._/-]*$/, 'an absolute path in the container').optional() }).catchall(z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(64)).max(128)])))
      .optional(),
    /** More recipe folders, relative to the project; after octopod's own and OCTOPOD_RECIPES, before `.octopod/recipes/`. */
    recipes: z.array(z.string().min(1).max(400)).optional(),
    /** The folder a recipe's workspace mounts; the project's folder by default. */
    workspace: z.string().min(1).max(400).optional(),
    /** To find it among the others: one group (`m2m`), and free tags (`php`, `legacy`). */
    group: z.string().regex(LABEL_RE, 'must be a DNS label: a-z, 0-9 and -, at most 63').optional(),
    tags: z.array(z.string().regex(LABEL_RE, 'must be a DNS label: a-z, 0-9 and -, at most 63')).max(16).optional(),
  })
  .strict();

export interface Exposure {
  service: string;
  /** Declared: it wins. Absent: octopod finds it in the compose file or the image. */
  port?: number;
  /** The full host name, e.g. api.demo.localhost. */
  host: string;
}

export interface Declaration {
  project: string;
  /** Instance N of the project, 1 for the project itself; `project` is then `<base>-N`. */
  instance?: number;
  /** The project's own name, whatever the instance. */
  base?: string;
  root: string;
  /** Compose files, absolute. */
  compose: string[];
  /** The declared env file, absolute: passed as --env-file. */
  envFile?: string;
  /** Services made of recipes, with their parameters. */
  services?: Record<string, { recipe: string; params: Record<string, string | number | boolean | string[]>; programs?: Record<string, ProgramSpec>; supervisorD?: string; actions?: Record<string, ActionSpec>; home?: true | string; workdir?: string }>;
  /** Extra recipe folders, absolute, in the order declared. */
  recipeDirs?: string[];
  /** The folder a recipe's workspace mounts, absolute. */
  workspace?: string;
  /** Its group and its tags, to find it among the others. */
  group?: string;
  tags?: string[];
  /** Services made of tool recipes: built by `up`, never started by it. */
  tools?: string[];
  /** Compose profiles the recipes put services in: activated, or those services would not start. */
  profiles?: string[];
  expose: Exposure[];
}

export class DeclarationError extends Error {}

export async function loadDeclaration(root: string): Promise<Declaration> {
  const file = join(root, DECLARATION_FILE);
  let raw: unknown;
  try {
    raw = parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new DeclarationError(`${file}: ${(e as Error).message}`);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    throw new DeclarationError(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  const project = parsed.data.project ?? slugify(basename(root));
  if (RESERVED_PROJECTS.includes(project)) {
    throw new DeclarationError(`${file}: "${project}" is the edge's own name (${project}.localhost); give the project another with project:`);
  }

  let compose: string[];
  if (parsed.data.compose) {
    compose = parsed.data.compose.map((f) => join(root, f));
  } else {
    const found = [];
    for (const name of DEFAULT_COMPOSE) {
      if (await stat(join(root, name)).then(() => true, () => false)) found.push(join(root, name));
    }
    if (found.length === 0 && !parsed.data.services) throw new DeclarationError(`${file}: no compose file in ${root} (${DEFAULT_COMPOSE.join(', ')}), and no services`);
    // As compose itself does without -f: the main file, then its override when there is
    // one. octopod passes -f, which turns that lookup off — so it does it here.
    compose = [];
    if (found.length > 0) {
      const prefix = basename(found[0]).replace(/\.ya?ml$/, '');
      const override = [`${prefix}.override.yaml`, `${prefix}.override.yml`].map((n) => join(root, n));
      const present = [];
      for (const o of override) if (await stat(o).then(() => true, () => false)) present.push(o);
      compose = [found[0], ...present.slice(0, 1)];
    }
  }

  const expose: Exposure[] = [];
  const seen = new Set<string>();
  for (const e of parsed.data.expose) {
    let host: string;
    try {
      host = fullHost(project, e.host);
    } catch (err) {
      throw new DeclarationError(`${file}: ${(err as Error).message}`);
    }
    if (seen.has(host)) throw new DeclarationError(`${file}: host ${host} is exposed twice`);
    seen.add(host);
    expose.push({ service: e.service, host, ...(e.port !== undefined ? { port: e.port } : {}) });
  }
  let envFile: string | undefined;
  if (parsed.data.env_file !== undefined) {
    envFile = resolve(root, parsed.data.env_file);
    if (relative(root, envFile).startsWith('..') || isAbsolute(parsed.data.env_file)) {
      throw new DeclarationError(`${file}: env_file must be a path inside the project`);
    }
  }
  if (expose.length === 0 && !parsed.data.services) throw new DeclarationError(`${file}: nothing to serve — declare expose, or services made of recipes`);
  let services: Declaration['services'];
  if (parsed.data.services) {
    services = {};
    // A folder of the project a service mounts. It must exist: docker would create a missing
    // one, as root, in the project.
    const folder = async (service: string, key: string, path: string): Promise<string> => {
      const abs = resolve(root, path);
      if (isAbsolute(path) || relative(root, abs).startsWith('..')) throw new DeclarationError(`${file}: services.${service}.${key} must be a folder inside the project`);
      if (!(await stat(abs).then((st) => st.isDirectory(), () => false))) throw new DeclarationError(`${file}: services.${service}.${key}: ${path} is not a folder of the project`);
      return abs;
    };
    for (const [name, { recipe, programs, supervisor_d, actions, home, workdir, ...params }] of Object.entries(parsed.data.services)) {
      const supervisorD = supervisor_d !== undefined ? await folder(name, 'supervisor_d', supervisor_d) : undefined;
      const homeDir = typeof home === 'string' ? await folder(name, 'home', home) : home;
      services[name] = {
        recipe,
        params,
        ...(programs ? { programs } : {}),
        ...(supervisorD ? { supervisorD } : {}),
        ...(actions ? { actions } : {}),
        ...(homeDir ? { home: homeDir } : {}),
        ...(workdir ? { workdir } : {}),
      };
    }
  }
  return {
    project,
    root,
    compose,
    expose,
    ...(envFile ? { envFile } : {}),
    ...(services ? { services } : {}),
    ...(parsed.data.recipes ? { recipeDirs: parsed.data.recipes.map((d) => resolve(root, d)) } : {}),
    ...(parsed.data.workspace ? { workspace: resolve(root, parsed.data.workspace) } : {}),
    ...(parsed.data.group ? { group: parsed.data.group } : {}),
    ...(parsed.data.tags?.length ? { tags: [...new Set(parsed.data.tags)] } : {}),
  };
}

/** The declaration of instance N: its name, and its hosts moved under that name. */
export function withInstance(declaration: Declaration, n: number): Declaration {
  const name = instanceName(declaration.project, n);
  if (n === 1) return declaration;
  const suffix = `${declaration.project}.localhost`;
  return {
    ...declaration,
    project: name,
    instance: n,
    base: declaration.project,
    expose: declaration.expose.map((e) => ({ ...e, host: `${e.host.slice(0, -suffix.length)}${name}.localhost` })),
  };
}
