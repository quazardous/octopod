import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_MS, ConsoleAccess, MAX_FAILURES, SESSION_MS, sessionCookie, sessionsOf } from './consoleAccess.js';

describe("the console's enrollment", () => {
  let dir: string;
  let file: string;
  let clock: number;
  let access: ConsoleAccess;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopod-access-'));
    file = join(dir, 'console-access.json');
    clock = 1_000_000;
    access = new ConsoleAccess(file, () => clock);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('opens a session for a code, once, typed however', async () => {
    const { code } = await access.code();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const session = await access.enroll(` ${code.toLowerCase().replace('-', ' ')} `);
    expect(session).toBeTruthy();
    expect(await access.valid(session!)).toBe(true);
    expect(await access.enroll(code)).toBeNull();
    expect(await access.valid('another')).toBe(false);
    expect(await access.valid(undefined)).toBe(false);
  });

  it('keeps digests only, readable by the operator alone', async () => {
    const { code } = await access.code();
    const session = await access.enroll(code);
    const { code: waiting } = await access.code();
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(session!);
    expect(text).not.toContain(waiting.replace('-', ''));
    // Windows has no such modes: its user profile keeps the state directory.
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('lets a code wait ten minutes, and a session last thirty days', async () => {
    const late = await access.code();
    clock += CODE_MS + 1;
    expect(await access.enroll(late.code)).toBeNull();
    const session = await access.enroll((await access.code()).code);
    clock += SESSION_MS - 1;
    expect(await access.valid(session!)).toBe(true);
    clock += 2;
    expect(await access.valid(session!)).toBe(false);
  });

  it('voids the waiting codes after wrong ones in a row', async () => {
    const { code } = await access.code();
    for (let i = 0; i < MAX_FAILURES; i++) expect(await access.enroll('AAAA-AAAA')).toBeNull();
    expect(await access.enroll(code)).toBeNull();
    expect(await access.enroll((await access.code()).code)).toBeTruthy();
  });

  it('signs one browser out, or every one', async () => {
    const one = await access.enroll((await access.code()).code);
    const two = await access.enroll((await access.code()).code);
    await access.signOut(one!);
    expect(await access.valid(one!)).toBe(false);
    expect(await access.valid(two!)).toBe(true);
    const waiting = await access.code();
    expect(await access.revoke()).toBe(1);
    expect(await access.valid(two!)).toBe(false);
    expect(await access.enroll(waiting.code)).toBeNull();
  });

  it('reads its cookie, and writes it for the console only', () => {
    expect(sessionsOf('a=1; octopod_console=abc_-; b=2')).toEqual(['abc_-']);
    expect(sessionsOf(undefined)).toEqual([]);
    // One planted by a project for the whole domain, beside the console's own: both are read.
    expect(sessionsOf('octopod_console=planted; octopod_console=mine')).toEqual(['planted', 'mine']);
    expect(sessionCookie('abc')).toBe(`octopod_console=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
    expect(sessionCookie(null)).toContain('Max-Age=0');
  });
});
