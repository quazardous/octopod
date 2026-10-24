/**
 * JSON Schemas of `octopod.yaml` and `recipe.yaml`, from the zod schemas octopod checks them
 * with: for an editor's completion (`# yaml-language-server: $schema=…`). Written to
 * `schema/` by `npm run schemas`; a test fails while they differ.
 */
import { z } from 'zod';
import { DeclarationSchema } from './declaration.js';
import { RecipeSchema } from './recipes/recipe.js';

const BASE = 'https://raw.githubusercontent.com/quazardous/octopod/main/schema';

export function jsonSchemas(): Record<string, Record<string, unknown>> {
  const of = (schema: z.ZodType, name: string, title: string) => ({
    $id: `${BASE}/${name}`,
    title,
    ...z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }),
  });
  return {
    'octopod.schema.json': of(DeclarationSchema, 'octopod.schema.json', "octopod.yaml: a project's declaration"),
    'recipe.schema.json': of(RecipeSchema, 'recipe.schema.json', 'recipe.yaml: an octopod recipe'),
  };
}
