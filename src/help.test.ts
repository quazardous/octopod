import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP, helpText } from './help.js';

describe('the help', () => {
  it('has every command the CLI answers, and nothing it does not', () => {
    const cli = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8');
    const answered = [...cli.matchAll(/^ {4}case '([a-z][a-z-]*)'/gm)].map((m) => m[1]);
    expect(new Set(answered)).toEqual(new Set(Object.keys(HELP).filter((c) => c !== 'help')));
  });

  it("says one command's usage and flags, and lists them all", () => {
    expect(helpText('run')).toMatch(/^usage: octopod run \[project\] <service>/);
    expect(helpText('run')).toContain('--yes');
    expect(helpText()).toMatch(/^ {2}oidc +The users/m);
    expect(helpText('nope')).toMatch(/no command "nope"/);
  });
});
