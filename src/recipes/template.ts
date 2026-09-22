/**
 * The only substitution octopod performs in a recipe: `{{scope.key}}` inside recipe-authored
 * strings.
 *
 * Strict on purpose — an unknown token throws instead of rendering an empty string. A
 * silently empty `DATABASE_URL` is the kind of bug that surfaces as an unexplained
 * connection error twenty minutes later.
 */
const TOKEN = /\{\{\s*([a-z][a-z0-9]*)\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}|\{\{\s*([a-z][a-z0-9]*)\s*\}\}/g;

export type Scopes = Record<string, string | Record<string, string | number | boolean>>;

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Render one string. `where` names the site for the error message. */
export function render(input: string, scopes: Scopes, where: string): string {
  return input.replace(TOKEN, (match, scope: string | undefined, key: string | undefined, bare: string | undefined) => {
    if (bare !== undefined) {
      const value = scopes[bare];
      if (typeof value !== 'string') {
        throw new TemplateError(`${where}: unknown value '${match}'`);
      }
      return value;
    }
    const bag = scopes[scope as string];
    if (bag === undefined || typeof bag === 'string') {
      throw new TemplateError(`${where}: unknown scope '${scope}' in '${match}'`);
    }
    const value = bag[key as string];
    if (value === undefined) {
      throw new TemplateError(`${where}: '${scope}.${key}' is not defined`);
    }
    return String(value);
  });
}

/** Render every value of a map. */
export function renderMap(
  input: Record<string, string>,
  scopes: Scopes,
  where: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, render(v, scopes, `${where}.${k}`)]),
  );
}
