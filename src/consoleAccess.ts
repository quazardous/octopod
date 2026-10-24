/**
 * Who may use the console: a browser enrolled with a code. The code comes from the command
 * line (`octopod console code`), which only the operator runs; pasted in the console's login
 * page, it becomes a session, kept in a cookie. Without one, the API answers the console
 * nothing but the login.
 *
 * The state file keeps digests only, never a code or a session as given: whoever reads it
 * cannot enroll with what it holds.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The cookie that carries a session. */
export const SESSION_COOKIE = 'octopod_console';
/** How long a code may wait to be pasted. */
export const CODE_MS = 10 * 60_000;
/** How long a session lasts. */
export const SESSION_MS = 30 * 24 * 3600_000;
/** Wrong codes in a row before the waiting ones are void: a code is guessed in no fewer. */
export const MAX_FAILURES = 5;
/** No 0/O, 1/I/L: a code is read from a terminal and typed. 31 signs: 8 make about 40 bits. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface AccessState {
  codes: { digest: string; expires: number }[];
  sessions: { digest: string; created: number }[];
  failures: number;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
/** What the operator typed, as the code was printed: case, spaces and dashes aside. */
const normal = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class ConsoleAccess {
  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  private async read(): Promise<AccessState> {
    try {
      const s = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AccessState>;
      return { codes: s.codes ?? [], sessions: s.sessions ?? [], failures: s.failures ?? 0 };
    } catch {
      return { codes: [], sessions: [], failures: 0 };
    }
  }

  private async write(state: AccessState): Promise<void> {
    const now = this.now();
    state.codes = state.codes.filter((c) => c.expires > now);
    state.sessions = state.sessions.filter((s) => s.created + SESSION_MS > now);
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  }

  /** A new code, `XXXX-XXXX`, for one enrollment within {@link CODE_MS}. */
  async code(): Promise<{ code: string; expires: number }> {
    const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const expires = this.now() + CODE_MS;
    const state = await this.read();
    state.codes.push({ digest: digest(raw), expires });
    await this.write(state);
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expires };
  }

  /**
   * The session a waiting code opens, the code used up; null for a wrong or expired one.
   * After {@link MAX_FAILURES} wrong ones in a row every waiting code is void: a new one is
   * asked for on the command line.
   */
  async enroll(code: string): Promise<string | null> {
    const state = await this.read();
    const now = this.now();
    const wanted = digest(normal(code));
    const match = state.codes.find((c) => c.digest === wanted && c.expires > now);
    if (!match) {
      state.failures += 1;
      if (state.failures >= MAX_FAILURES) {
        state.codes = [];
        state.failures = 0;
      }
      await this.write(state);
      return null;
    }
    const session = randomBytes(32).toString('base64url');
    state.codes = state.codes.filter((c) => c !== match);
    state.failures = 0;
    state.sessions.push({ digest: digest(session), created: now });
    await this.write(state);
    return session;
  }

  /** A session that is open. */
  async valid(session: string | undefined): Promise<boolean> {
    if (!session) return false;
    const wanted = digest(session);
    const now = this.now();
    return (await this.read()).sessions.some((s) => s.digest === wanted && s.created + SESSION_MS > now);
  }

  /** Closes one session: the console's Sign out. */
  async signOut(session: string | undefined): Promise<void> {
    if (!session) return;
    const state = await this.read();
    const wanted = digest(session);
    state.sessions = state.sessions.filter((s) => s.digest !== wanted);
    await this.write(state);
  }

  /** Closes every session and voids every waiting code: each browser enrolls again. */
  async revoke(): Promise<number> {
    const state = await this.read();
    const closed = state.sessions.length;
    await this.write({ codes: [], sessions: [], failures: 0 });
    return closed;
  }
}

/**
 * The sessions a request's Cookie header carries: every value of the console's cookie. The
 * projects share the console's site (`*.octopod.localhost`): one of them may set a cookie of
 * that name for the whole domain, which the browser sends beside the console's own — one
 * true session among them is enough, a planted one never is.
 */
export function sessionsOf(cookie: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value.length > 0) out.push(value.join('='));
  }
  return out;
}

/** The Set-Cookie of a session, or of its removal: the console's own pages only, never sent cross-site. */
export function sessionCookie(session: string | null): string {
  const base = `${SESSION_COOKIE}=${session ?? ''}; Path=/; HttpOnly; SameSite=Strict`;
  return session ? `${base}; Max-Age=${SESSION_MS / 1000}` : `${base}; Max-Age=0`;
}
