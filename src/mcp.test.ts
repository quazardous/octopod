import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_TOOLS, mcpServer } from './mcp.js';
import type { Octopod } from './octopod.js';
import { mcpCommand } from './setup.js';

/** An Octopod that records what it is asked: the server's rules, not Docker's. */
function fakeOctopod(overrides: Partial<Record<keyof Octopod, unknown>> = {}) {
  return {
    edgeStatus: vi.fn(async () => ({ running: true, port: 80 })),
    list: vi.fn(async () => [{ name: 'demo', root: '/somewhere' }]),
    status: vi.fn(async (name: string) => ({ name, services: [] })),
    logs: vi.fn(async () => ['web | GET / 200', 'web | GET /boom 500', 'db | ready']),
    exec: vi.fn(async () => ({ ok: true, mode: 'exec', output: 'hi\n', truncated: false })),
    down: vi.fn(async (name: string) => ({ name, services: [] })),
    restart: vi.fn(async (name: string) => ({ name, services: [] })),
    up: vi.fn(async (name: string) => ({ name, services: [] })),
    ensureRegistered: vi.fn(async () => ({ name: 'demo', registered: false })),
    runAction: vi.fn(async () => ({ ok: true, code: 0, stderr: '' })),
    plan: vi.fn(async () => ({ text: '+ app  node-app' })),
    oidcSession: vi.fn(async () => ({ header: 'sessionid=abc', cookies: [], landed: 'http://app/me', jar: '' })),
    oidcLink: vi.fn(async () => ({ url: 'http://id/sign-in?ticket=t', expires_in: 120 })),
    oidcToken: vi.fn(async () => ({ id_token: 'x.y.z' })),
    ...overrides,
  };
}

describe('octopod mcp', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-mcp-'));
    await writeFile(join(dir, 'octopod.yaml'), 'project: demo\nservices:\n  app: { recipe: node-app }\n');
    await mkdir(join(dir, 'src', 'deep'), { recursive: true });
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  async function connect(octopod: ReturnType<typeof fakeOctopod>, cwd = dir, upWaitMs?: number) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await mcpServer(octopod as unknown as Octopod, { cwd, upWaitMs }).connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content.map((c) => c.text).join(''), isError: Boolean(r.isError) };
    };
    return { client, call };
  }

  it('offers its tools, and neither secrets, a shell nor the edge', async () => {
    const { client } = await connect(fakeOctopod());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOLS]);
    expect(tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name)).toEqual(['octopod_status', 'octopod_logs', 'octopod_plan']);
    expect(tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)).toEqual(['octopod_run', 'octopod_down', 'octopod_restart']);
  });

  it("finds the project declared in the client's folder, or above it", async () => {
    const octopod = fakeOctopod();
    const { call } = await connect(octopod, join(dir, 'src', 'deep'));
    expect((await call('octopod_status')).isError).toBe(false);
    expect(octopod.status).toHaveBeenCalledWith('demo', undefined);
    await call('octopod_status', { project: 'other' });
    expect(octopod.status).toHaveBeenLastCalledWith('other', undefined);
    const nowhere = await connect(fakeOctopod(), tmpdir());
    expect(await nowhere.call('octopod_status')).toEqual({ text: expect.stringMatching(/no octopod\.yaml/), isError: true });
  });

  it('runs an argv, never a shell string', async () => {
    const octopod = fakeOctopod();
    const { call } = await connect(octopod);
    expect((await call('octopod_exec', { service: 'app', argv: ['ls', '-la'] })).isError).toBe(false);
    expect(octopod.exec).toHaveBeenCalledWith('demo', 'app', ['ls', '-la'], expect.objectContaining({ maxBytes: 65536 }));
    expect((await call('octopod_exec', { service: 'app', argv: 'ls -la' })).isError).toBe(true);
    expect((await call('octopod_exec', { service: 'app', argv: [] })).isError).toBe(true);
    expect(octopod.exec).toHaveBeenCalledTimes(1);
  });

  it('asks for confirm before it removes volumes, and passes it to a destructive action', async () => {
    const octopod = fakeOctopod();
    const { call } = await connect(octopod);
    expect(await call('octopod_down', { volumes: true })).toEqual({ text: expect.stringMatching(/confirm: true/), isError: true });
    expect(octopod.down).not.toHaveBeenCalled();
    await call('octopod_down', { volumes: true, confirm: true });
    expect(octopod.down).toHaveBeenCalledWith('demo', { volumes: true, instance: undefined });
    await call('octopod_run', { service: 'db', action: 'reset', confirm: true });
    expect(octopod.runAction).toHaveBeenCalledWith('demo', 'db', 'reset', expect.objectContaining({ confirm: true }));
    expect((await call('octopod_run', { service: 'db', action: 'load', input: 'dump.sql' })).isError).toBe(true);
  });

  it('signs an app in as a user, or gives a link or tokens; a user or claims is needed', async () => {
    const octopod = fakeOctopod();
    const { call } = await connect(octopod);
    expect((await call('octopod_oidc_session', { user: 'ada', url: 'http://app.demo.octopod.localhost/login' })).text).toContain('sessionid=abc');
    expect(octopod.oidcSession).toHaveBeenCalledWith('demo', { sub: 'ada' }, 'http://app.demo.octopod.localhost/login', undefined);
    expect((await call('octopod_oidc_session', { user: 'ada', url: 'http://app.demo.octopod.localhost/login', link: true })).text).toContain('sign-in?ticket');
    expect((await call('octopod_oidc_token', { claims: { groups: ['beta'] } })).text).toContain('x.y.z');
    expect((await call('octopod_oidc_token', {})).isError).toBe(true);
  });

  it('keeps the lines of the logs that match', async () => {
    const { call } = await connect(fakeOctopod());
    expect((await call('octopod_logs', { match: 'GET' })).text).toBe('web | GET / 200\nweb | GET /boom 500');
  });

  it('answers an up that takes long, which goes on, and says so in the status', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const octopod = fakeOctopod({ up: vi.fn(() => new Promise((r) => (finish = r))) });
    const { call } = await connect(octopod, dir, 30);
    expect((await call('octopod_up')).text).toMatch(/still running/);
    expect(octopod.ensureRegistered).toHaveBeenCalledWith(dir);
    expect((await call('octopod_up')).text).toMatch(/already running/);
    expect((await call('octopod_status')).text).toMatch(/"up": "still running"/);
    finish({ name: 'demo', services: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect((await call('octopod_status')).text).not.toMatch(/still running/);
    expect(octopod.up).toHaveBeenCalledTimes(1);
  });

  it('is registered as the service is run, mcp instead of serve', () => {
    expect(mcpCommand(['/usr/bin/node', '/opt/octopod/bin/octopod.js', 'serve'])).toEqual(['/usr/bin/node', '/opt/octopod/bin/octopod.js', 'mcp']);
  });
});
