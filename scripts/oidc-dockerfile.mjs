#!/usr/bin/env node
// Writes recipes/oidc/Dockerfile from the provider's sources in src/oidc and its admin app in
// oidc-admin: a recipe's build context is its Dockerfile alone, so they go in it as heredocs
// — the server compiled, the admin's sources built by a stage of the image (npm ci, vite).
// Run it after changing either (npm run oidc:recipe); a test fails while they differ.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('..', import.meta.url);
const FILES = ['users', 'admin', 'provider', 'server'];

/** The admin app's sources: what `vite build` needs, its lockfile included. */
function adminFiles() {
  const out = ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts'];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`oidc-admin/${dir}`, root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else out.push(`${dir}${entry.name}`);
    }
  };
  walk('src/');
  return out;
}

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
    '# The admin app (oidc-admin, a qdadm app), built here; only its dist/ goes on.',
    'FROM ${BASE_IMAGE} AS admin',
    'WORKDIR /admin',
    ...adminFiles().flatMap((file, i) => [`COPY <<'OIDC_ADMIN_${i}' /admin/${file}`, readFileSync(new URL(`oidc-admin/${file}`, root), 'utf8').trimEnd(), `OIDC_ADMIN_${i}`]),
    'RUN npm ci --no-audit --no-fund --legacy-peer-deps && npx vite build',
    '',
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
    'COPY --from=admin /admin/dist /opt/oidc/admin',
    'ENV OIDC_DATA=/data PORT=8080 OIDC_ADMIN_DIR=/opt/oidc/admin',
    'USER ${USER_NAME}',
    'CMD ["node", "/opt/oidc/server.js"]',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('recipes/oidc/Dockerfile', root), render());
}
