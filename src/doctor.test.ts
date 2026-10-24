import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Docker } from './docker.js';
import { Octopod } from './octopod.js';

describe('octopod doctor', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'octopod-doctor-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const byName = async (octopod: Octopod) => Object.fromEntries((await octopod.doctor()).checks.map((c) => [c.name, c]));

  it('says Docker is missing, and how to put it right', async () => {
    const down: Docker = { run: async () => Promise.reject(new Error('Cannot connect to the Docker daemon')) };
    const checks = await byName(new Octopod({ stateDir: join(base, 'state'), docker: down, socket: join(base, 'none.sock'), tcp: false }));
    expect(checks.docker).toEqual(expect.objectContaining({ ok: false, fix: expect.stringContaining('docker version') }));
    expect(checks.compose?.ok).toBe(false);
    expect(checks.edge?.ok).toBe(false);
    expect(checks.api).toEqual(expect.objectContaining({ ok: false }));
  });

  it('finds a project whose folder is gone, and names the way out', async () => {
    const answers: Docker = { run: async (args) => (args[0] === 'version' ? '29.0.0' : args[0] === 'compose' ? '2.30.0' : '') };
    const state = join(base, 'state');
    await mkdir(state, { recursive: true });
    await mkdir(join(base, 'here'));
    await writeFile(join(base, 'here', 'octopod.yaml'), 'project: here\n');
    await writeFile(join(state, 'projects.json'), JSON.stringify({ here: join(base, 'here'), gone: join(base, 'gone') }));
    const checks = await byName(new Octopod({ stateDir: state, docker: answers, socket: join(base, 'none.sock'), tcp: false }));
    expect(checks.docker).toEqual(expect.objectContaining({ ok: true, detail: 'Docker 29.0.0' }));
    expect(checks.projects).toEqual(expect.objectContaining({ ok: false, fix: 'octopod unregister gone' }));
  });
});
