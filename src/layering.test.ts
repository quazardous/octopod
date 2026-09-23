/**
 * The layering a project relies on: the rendered recipes, then its own compose files,
 * then octopod's override — later files win, as in compose.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Octopod } from './octopod.js';
import type { Docker } from './docker.js';

let base: string;
let calls: string[][];

const docker: Docker = {
  run: async (args) => {
    calls.push(args);
    if (args.includes('config')) return JSON.stringify({ services: { web: { image: 'x', expose: ['80'] }, who: { image: 'traefik/whoami' } } });
    if (args[0] === 'network' && args[1] === 'inspect') return '[{"Subnet":"10.9.0.0/24"}]';
    return '';
  },
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'octopod-layering-'));
  calls = [];
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('layering', () => {
  it('passes the recipes first, then the project\'s compose files, then octopod\'s override', async () => {
    const root = join(base, 'demo');
    await mkdir(root);
    await writeFile(join(root, 'docker-compose.yml'), 'services:\n  web: { image: x }\n');
    await writeFile(join(root, 'docker-compose.override.yml'), 'services:\n  web: { image: y }\n');
    await writeFile(join(root, 'octopod.yaml'), 'expose:\n  - {service: web, port: 80, host: www}\nservices:\n  who: { recipe: whoami }\n');
    const octopod = new Octopod({ stateDir: join(base, 'state'), docker, ports: [18497], socket: join(base, 'run', 'o.sock') });
    await octopod.register(root);
    await octopod.up('demo');
    const up = calls.find((a) => a.includes('-p') && a.includes('demo') && a.includes('up'));
    const files = (up ?? []).flatMap((a, i, all) => (all[i - 1] === '-f' ? [a] : []));
    expect(files.map((f) => basename(f))).toEqual(['recipes.demo.json', 'docker-compose.yml', 'docker-compose.override.yml', 'override.json']);
  });
});
