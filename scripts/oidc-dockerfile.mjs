#!/usr/bin/env node
// Writes recipes/oidc/Dockerfile from the provider's sources in src/oidc: a recipe's build
// context is its Dockerfile alone, so the server goes in it, compiled, as heredocs. Run it
// after changing src/oidc (npm run oidc:recipe); a test fails while the two differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('..', import.meta.url);
const FILES = ['users', 'admin', 'provider', 'server'];

export function render() {
  const js = (name) =>
    ts
      .transpileModule(readFileSync(new URL(`src/oidc/${name}.ts`, root), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, removeComments: false },
      })
      .outputText.trimEnd();
  return [
    '# syntax=docker/dockerfile:1',
    '# GENERATED from src/oidc by scripts/oidc-dockerfile.mjs: edit those, then run',
    '# `npm run oidc:recipe`. The provider runs as the image\'s `node` user, renamed after the',
    '# project and moved to the operator\'s uid/gid; its signing key is kept in /data.',
    'ARG BASE_IMAGE',
    'FROM ${BASE_IMAGE}',
    'ARG UID=1000',
    'ARG GID=1000',
    'ARG USER_NAME=app',
    'RUN groupmod -o -g "$GID" -n "$USER_NAME" node \\',
    ' && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m node',
    "COPY <<'OIDC_PACKAGE' /opt/oidc/package.json",
    '{ "type": "module" }',
    'OIDC_PACKAGE',
    ...FILES.flatMap((name) => [`COPY <<'OIDC_${name.toUpperCase()}' /opt/oidc/${name}.js`, js(name), `OIDC_${name.toUpperCase()}`]),
    'ENV OIDC_DATA=/data PORT=8080',
    'USER ${USER_NAME}',
    'CMD ["node", "/opt/oidc/server.js"]',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('recipes/oidc/Dockerfile', root), render());
}
