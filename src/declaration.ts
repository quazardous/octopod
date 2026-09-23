/**
 * `octopod.yaml`: what a project exposes. The project keeps its own compose files; this
 * only says which services the edge routes to, on which port, under which host.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { fullHost, instanceName, LABEL_RE, RESERVED_PROJECTS, slugify } from './names.js';

export const DECLARATION_FILE = 'octopod.yaml';
const DEFAULT_COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

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
      .record(z.string(), z.object({ recipe: z.string().min(1).max(64) }).catchall(z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(64)).max(128)])))
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
  services?: Record<string, { recipe: string; params: Record<string, string | number | boolean | string[]> }>;
  /** Extra recipe folders, absolute, in the order declared. */
  recipeDirs?: string[];
  /** The folder a recipe's workspace mounts, absolute. */
  workspace?: string;
  /** Its group and its tags, to find it among the others. */
  group?: string;
  tags?: string[];
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
  const services = parsed.data.services
    ? Object.fromEntries(Object.entries(parsed.data.services).map(([name, { recipe, ...params }]) => [name, { recipe, params }]))
    : undefined;
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
