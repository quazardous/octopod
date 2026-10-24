/**
 * The provider's users: who may sign in, with which claims, and with which password (kept
 * as a scrypt hash, never as given). Kept in one JSON file of the provider's data, written
 * whole and atomically: a development provider has a handful of users, not a directory.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface User {
  sub: string;
  claims: Record<string, unknown>;
  /** `scrypt$<salt>$<hash>`, base64url; none: a user that signs in without a password (development). */
  password?: string;
  /** The issuers it may sign in to; all of them when absent. */
  issuers?: string[];
}

/** What the admin API shows of a user: never its password's hash. */
export type PublicUser = Omit<User, 'password'> & { password: boolean };

const SUB = /^[A-Za-z0-9._@+-]{1,128}$/;
const ISSUER = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

export function passwordMatches(hash: string | undefined, password: string): boolean {
  const [kind, salt, expected] = (hash ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !expected) return false;
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(expected, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A user as the admin API gives it, checked; an error to say otherwise. */
export function userOf(sub: string, body: unknown, previous?: User): User | { error: string } {
  if (!SUB.test(sub)) return { error: 'a user name is 1 to 128 letters, digits and . _ @ + -' };
  const input = (body ?? {}) as { claims?: unknown; password?: unknown; issuers?: unknown };
  if (input.claims !== undefined && (typeof input.claims !== 'object' || input.claims === null || Array.isArray(input.claims))) return { error: 'claims must be a JSON object' };
  if (input.password !== undefined && input.password !== null && (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 200)) {
    return { error: 'password must be a string of 1 to 200 characters, or null to remove it' };
  }
  if (input.issuers !== undefined && input.issuers !== null && (!Array.isArray(input.issuers) || !input.issuers.every((i) => typeof i === 'string' && ISSUER.test(i)))) {
    return { error: 'issuers must be a list of issuer names, or null for all of them' };
  }
  const claims = (input.claims as Record<string, unknown> | undefined) ?? previous?.claims ?? {};
  const password = input.password === null ? undefined : typeof input.password === 'string' ? hashPassword(input.password) : previous?.password;
  const issuers = input.issuers === null ? undefined : ((input.issuers as string[] | undefined) ?? previous?.issuers);
  return { sub, claims, ...(password ? { password } : {}), ...(issuers ? { issuers } : {}) };
}

export const shown = (u: User): PublicUser => ({ sub: u.sub, claims: u.claims, password: Boolean(u.password), ...(u.issuers ? { issuers: u.issuers } : {}) });

export class Users {
  constructor(private readonly file: string) {}

  all(): User[] {
    try {
      return (JSON.parse(readFileSync(this.file, 'utf8')) as { users?: User[] }).users ?? [];
    } catch {
      return [];
    }
  }

  get(sub: string): User | undefined {
    return this.all().find((u) => u.sub === sub);
  }

  /** The users who may sign in to an issuer. */
  of(issuer: string): User[] {
    return this.all().filter((u) => !u.issuers || u.issuers.includes(issuer));
  }

  put(user: User): void {
    this.write([...this.all().filter((u) => u.sub !== user.sub), user].sort((a, b) => a.sub.localeCompare(b.sub)));
  }

  delete(sub: string): boolean {
    const all = this.all();
    if (!all.some((u) => u.sub === sub)) return false;
    this.write(all.filter((u) => u.sub !== sub));
    return true;
  }

  private write(users: User[]): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
