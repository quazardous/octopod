/**
 * Where recipes come from: folders, from the most general to the closest — octopod's own,
 * the ones named in OCTOPOD_RECIPES, the ones a project declares, the project's
 * `.octopod/recipes/`. A recipe is a subfolder: `<id>/recipe.yaml`, and its `Dockerfile`
 * when it builds. The closest folder wins a name, and the one it hides is reported.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { IDENT, RecipeSchema, type Recipe } from './recipe.js';

export const BUILTIN_RECIPES = fileURLToPath(new URL('../../recipes', import.meta.url));

export interface RecipeEntry {
  id: string;
  recipe: Recipe;
  /** sha256 of the recipe (and its Dockerfile), 12 hex: what a plan cites. */
  digest: string;
  /** The folder it came from. */
  dir: string;
  dockerfile?: string;
}

export interface Shadowed {
  id: string;
  dir: string;
  /** The closer folder whose recipe of the same name wins. */
  by: string;
}

export interface RecipeBook {
  recipes: Map<string, RecipeEntry>;
  shadowed: Shadowed[];
}

export class RecipeError extends Error {}

/** Key-sorted JSON, so formatting and key order do not move the digest. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function digestOf(recipe: Recipe, dockerfile?: string): string {
  const hash = createHash('sha256').update(canonicalize(recipe));
  // What gets built is part of what is approved.
  if (dockerfile !== undefined) hash.update('\0').update(dockerfile);
  return hash.digest('hex').slice(0, 12);
}

/** Read one recipe folder. */
export async function loadRecipe(dir: string, id: string): Promise<RecipeEntry> {
  const file = join(dir, id, 'recipe.yaml');
  let raw: unknown;
  try {
    raw = parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new RecipeError(`${file}: ${(e as Error).message}`);
  }
  const parsed = RecipeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RecipeError(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  const recipe = parsed.data;
  if (!recipe.unpinned && !recipe.image.includes('@sha256:')) {
    throw new RecipeError(`${file}: image '${recipe.image}' is a moving tag — pin a digest or set "unpinned: true"`);
  }
  for (const volume of recipe.volumes) {
    if (volume.when && recipe.params[volume.when]?.type !== 'bool') {
      throw new RecipeError(`${file}: volume '${volume.name}': "when" must name a bool param, not '${volume.when}'`);
    }
  }
  for (const req of recipe.requires) {
    if (recipe.provides.includes(req.capability)) throw new RecipeError(`${file}: requires '${req.capability}', which it also provides`);
  }
  let dockerfile: string | undefined;
  if (recipe.build) {
    dockerfile = await readFile(join(dir, id, 'Dockerfile'), 'utf8').catch(() => {
      throw new RecipeError(`${file}: builds, but ${join(dir, id, 'Dockerfile')} is missing`);
    });
  }
  return { id, recipe, dir, digest: digestOf(recipe, dockerfile), ...(dockerfile !== undefined ? { dockerfile } : {}) };
}

/** The folders named in OCTOPOD_RECIPES, a PATH-like list. */
export function envRecipeDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OCTOPOD_RECIPES ?? '').split(delimiter).filter(Boolean);
}

/** Load every recipe of these folders, later folders winning a name. A missing folder is skipped. */
export async function loadRecipes(dirs: string[]): Promise<RecipeBook> {
  const recipes = new Map<string, RecipeEntry>();
  const shadowed: Shadowed[] = [];
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const id of names.sort()) {
      if (!IDENT.test(id)) continue;
      if (!(await stat(join(dir, id, 'recipe.yaml')).then((s) => s.isFile(), () => false))) continue;
      const entry = await loadRecipe(dir, id);
      const hidden = recipes.get(id);
      if (hidden) shadowed.push({ id, dir: hidden.dir, by: dir });
      recipes.set(id, entry);
    }
  }
  return { recipes, shadowed };
}
