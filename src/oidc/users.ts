/**
 * The provider's users and groups: who may sign in, with which attributes, in which groups,
 * and with which password (kept as a scrypt hash, never as given). A user's claims are its
 * groups' claims, then its own attributes, then the names of its groups. Kept in one JSON file
 * of the provider's data, written whole and atomically: a development provider has a handful
 * of users, not a directory.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface User {
  sub: string;
  /** Its own attributes (email, name…): claims it signs as they are. */
  claims: Record<string, unknown>;
  /** The groups it is in: their claims, and their names in the groups claim. */
  groups?: string[];
  /** `scrypt$<salt>$<hash>`, base64url; none: a user that signs in without a password (development). */
  password?: string;
  /** The issuers it may sign in to; all of them when absent. */
  issuers?: string[];
}

/** A group: a name, what it is for, and the claims it gives its members (`roles: [admin]`). */
export interface Group {
  name: string;
  description?: string;
  claims?: Record<string, unknown>;
}

/** What the admin API shows of a user: never its password's hash. */
export type PublicUser = Omit<User, 'password'> & { password: boolean; groups: string[] };

const SUB = /^[A-Za-z0-9._@+-]{1,128}$/;
const GROUP = /^[A-Za-z0-9._@+-][A-Za-z0-9._@+ -]{0,63}$/;
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
  const input = (body ?? {}) as { claims?: unknown; password?: unknown; issuers?: unknown; groups?: unknown };
  if (input.claims !== undefined && (typeof input.claims !== 'object' || input.claims === null || Array.isArray(input.claims))) return { error: 'claims must be a JSON object' };
  if (input.password !== undefined && input.password !== null && (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 200)) {
    return { error: 'password must be a string of 1 to 200 characters, or null to remove it' };
  }
  if (input.issuers !== undefined && input.issuers !== null && (!Array.isArray(input.issuers) || !input.issuers.every((i) => typeof i === 'string' && ISSUER.test(i)))) {
    return { error: 'issuers must be a list of issuer names, or null for all of them' };
  }
  if (input.groups !== undefined && input.groups !== null && (!Array.isArray(input.groups) || !input.groups.every((g) => typeof g === 'string' && GROUP.test(g)))) {
    return { error: 'groups must be a list of group names (letters, digits, . _ @ + - and spaces, at most 64), or null for none' };
  }
  const claims = (input.claims as Record<string, unknown> | undefined) ?? previous?.claims ?? {};
  const groups = input.groups === null ? undefined : ((input.groups as string[] | undefined) ?? previous?.groups);
  const password = input.password === null ? undefined : typeof input.password === 'string' ? hashPassword(input.password) : previous?.password;
  const issuers = input.issuers === null ? undefined : ((input.issuers as string[] | undefined) ?? previous?.issuers);
  return { sub, claims, ...(groups && groups.length > 0 ? { groups: [...new Set(groups)] } : {}), ...(password ? { password } : {}), ...(issuers ? { issuers } : {}) };
}

/** A group as the admin API gives it, checked; an error to say otherwise. */
export function groupOf(name: string, body: unknown, previous?: Group): Group | { error: string } {
  if (!GROUP.test(name)) return { error: 'a group name is 1 to 64 letters, digits, . _ @ + - and spaces' };
  const input = (body ?? {}) as { description?: unknown; claims?: unknown };
  if (input.description !== undefined && input.description !== null && (typeof input.description !== 'string' || input.description.length > 400)) return { error: 'description must be text, at most 400' };
  if (input.claims !== undefined && input.claims !== null && (typeof input.claims !== 'object' || Array.isArray(input.claims))) return { error: 'claims must be a JSON object' };
  const description = input.description === null ? undefined : ((input.description as string | undefined) ?? previous?.description);
  const claims = input.claims === null ? undefined : ((input.claims as Record<string, unknown> | undefined) ?? previous?.claims);
  return { name, ...(description ? { description } : {}), ...(claims && Object.keys(claims).length > 0 ? { claims } : {}) };
}

export const shown = (u: User): PublicUser => ({ sub: u.sub, claims: u.claims, groups: u.groups ?? [], password: Boolean(u.password), ...(u.issuers ? { issuers: u.issuers } : {}) });

interface Store {
  users: User[];
  groups: Group[];
}

export class Users {
  /** `groupsClaim`: the claim the names of a user's groups are signed in (`groups`, `roles`…). */
  constructor(
    private readonly file: string,
    readonly groupsClaim = 'groups',
  ) {}

  private read(): Store {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Store>;
      return { users: raw.users ?? [], groups: raw.groups ?? [] };
    } catch {
      return { users: [], groups: [] };
    }
  }

  all(): User[] {
    return this.read().users;
  }

  get(sub: string): User | undefined {
    return this.all().find((u) => u.sub === sub);
  }

  /** The users who may sign in to an issuer. */
  of(issuer: string): User[] {
    return this.all().filter((u) => !u.issuers || u.issuers.includes(issuer));
  }

  /** A user, its groups made when they do not exist yet: a group typed on a user is a group. */
  put(user: User): void {
    const store = this.read();
    for (const name of user.groups ?? []) if (!store.groups.some((g) => g.name === name)) store.groups.push({ name });
    this.write({ users: [...store.users.filter((u) => u.sub !== user.sub), user], groups: store.groups });
  }

  delete(sub: string): boolean {
    const store = this.read();
    if (!store.users.some((u) => u.sub === sub)) return false;
    this.write({ ...store, users: store.users.filter((u) => u.sub !== sub) });
    return true;
  }

  groups(): Group[] {
    return this.read().groups;
  }

  group(name: string): Group | undefined {
    return this.groups().find((g) => g.name === name);
  }

  /** Who is in a group. */
  members(name: string): string[] {
    return this.all().filter((u) => u.groups?.includes(name)).map((u) => u.sub);
  }

  putGroup(group: Group): void {
    const store = this.read();
    this.write({ ...store, groups: [...store.groups.filter((g) => g.name !== group.name), group] });
  }

  /** A group away, and out of its members' groups. */
  deleteGroup(name: string): boolean {
    const store = this.read();
    if (!store.groups.some((g) => g.name === name)) return false;
    const users = store.users.map((u) => (u.groups?.includes(name) ? withGroups(u, u.groups.filter((g) => g !== name)) : u));
    this.write({ users, groups: store.groups.filter((g) => g.name !== name) });
    return true;
  }

  /** A group's members set: those named in, the others out. */
  setMembers(name: string, subs: string[]): void {
    const store = this.read();
    const users = store.users.map((u) => {
      const inIt = u.groups?.includes(name) ?? false;
      const wanted = subs.includes(u.sub);
      if (inIt === wanted) return u;
      return withGroups(u, wanted ? [...(u.groups ?? []), name] : (u.groups ?? []).filter((g) => g !== name));
    });
    this.write({ ...store, users });
  }

  /**
   * What a user signs: its groups' claims, then its own attributes (they win), then the
   * names of its groups in the groups claim.
   */
  claimsOf(user: User): Record<string, unknown> {
    const groups = this.groups();
    const fromGroups = Object.assign({}, ...(user.groups ?? []).map((n) => groups.find((g) => g.name === n)?.claims ?? {})) as Record<string, unknown>;
    return { ...fromGroups, ...user.claims, ...(user.groups && user.groups.length > 0 ? { [this.groupsClaim]: user.groups } : {}) };
  }

  /**
   * The store of an older provider, where a user's groups were a claim it typed: they become
   * its memberships, and the groups exist. Run at the start, once and again harmlessly.
   */
  migrate(): void {
    const store = this.read();
    let changed = false;
    const users = store.users.map((u) => {
      const typed = u.claims?.groups;
      if (u.groups || !Array.isArray(typed) || !typed.every((g) => typeof g === 'string' && GROUP.test(g))) return u;
      changed = true;
      const { groups: _typed, ...claims } = u.claims;
      return { ...u, claims, groups: typed as string[] };
    });
    const groups = [...store.groups];
    for (const name of users.flatMap((u) => u.groups ?? [])) {
      if (!groups.some((g) => g.name === name)) {
        groups.push({ name });
        changed = true;
      }
    }
    if (changed) this.write({ users, groups });
  }

  private write(store: Store): void {
    const sorted = { users: [...store.users].sort((a, b) => a.sub.localeCompare(b.sub)), groups: [...store.groups].sort((a, b) => a.name.localeCompare(b.name)) };
    writeFileSync(`${this.file}.tmp`, JSON.stringify(sorted, null, 2) + '\n', { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}

function withGroups(user: User, groups: string[]): User {
  const { groups: _old, ...rest } = user;
  return groups.length > 0 ? { ...rest, groups } : rest;
}
