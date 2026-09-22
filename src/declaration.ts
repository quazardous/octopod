/**
 * `octopod.yaml`: what a project exposes. The project keeps its own compose files; this
 * only says which services the edge routes to, on which port, under which host.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { fullHost, LABEL_RE, slugify } from './names.js';

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
      .min(1),
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
  root: string;
  /** Compose files, absolute. */
  compose: string[];
  /** The declared env file, absolute: passed as --env-file. */
  envFile?: string;
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

  let compose: string[];
  if (parsed.data.compose) {
    compose = parsed.data.compose.map((f) => join(root, f));
  } else {
    const found = [];
    for (const name of DEFAULT_COMPOSE) {
      if (await stat(join(root, name)).then(() => true, () => false)) found.push(join(root, name));
    }
    if (found.length === 0) throw new DeclarationError(`${file}: no compose file in ${root} (${DEFAULT_COMPOSE.join(', ')})`);
    // As compose itself does without -f: the main file, then its override when there is
    // one. octopod passes -f, which turns that lookup off — so it does it here.
    const prefix = basename(found[0]).replace(/\.ya?ml$/, '');
    const override = [`${prefix}.override.yaml`, `${prefix}.override.yml`].map((n) => join(root, n));
    const present = [];
    for (const o of override) if (await stat(o).then(() => true, () => false)) present.push(o);
    compose = [found[0], ...present.slice(0, 1)];
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
  return { project, root, compose, expose, ...(envFile ? { envFile } : {}) };
}
