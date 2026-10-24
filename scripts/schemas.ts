// Writes schema/octopod.schema.json and schema/recipe.schema.json from the zod schemas
// (npm run schemas); a test fails while they differ.
import { writeFileSync } from 'node:fs';
import { jsonSchemas } from '../src/schemas.js';

for (const [name, schema] of Object.entries(jsonSchemas())) {
  writeFileSync(new URL(`../schema/${name}`, import.meta.url), JSON.stringify(schema, null, 2) + '\n');
}
