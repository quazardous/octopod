#!/usr/bin/env node
// The `octopod` command. From a clone, or installed from the repository, it runs the
// TypeScript sources through tsx: nothing to build, and a change needs no new setup. A
// release, which ships only dist/, runs the build.
import { existsSync } from 'node:fs';

const sources = new URL('../src/cli.ts', import.meta.url);
if (existsSync(sources)) {
  const { register } = await import('tsx/esm/api');
  register();
  await import(sources.href);
} else {
  await import(new URL('../dist/cli.js', import.meta.url).href);
}
