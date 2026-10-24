import { describe, it, expect } from 'vitest';
import type { Declaration } from './declaration.js';
import { DEFAULT_GROUP, serverName, settleSharing } from './sharing.js';

const project = (extra: Partial<Declaration> = {}): Declaration => ({
  project: 'shop',
  root: '/p',
  compose: [],
  expose: [],
  services: { app: { recipe: 'php-app', params: {} }, db: { recipe: 'mariadb', params: {} }, mail: { recipe: 'mailpit', params: {} } },
  ...extra,
});
const shared = (d: Declaration) => Object.entries(d.services ?? {}).filter(([, s]) => s.shared).map(([n]) => n);

describe('sharing', () => {
  it('shares what the project lists, true meaning the databases', () => {
    expect(shared(settleSharing(project({ shared: true }), undefined))).toEqual(['db']);
    expect(shared(settleSharing(project({ shared: ['mariadb', 'mailpit'] }), undefined))).toEqual(['db', 'mail']);
    expect(shared(settleSharing(project(), undefined))).toEqual([]);
  });

  it("takes the machine's default when the project names none, and its own list over it", () => {
    expect(shared(settleSharing(project(), true))).toEqual(['db']);
    expect(shared(settleSharing(project({ shared: ['mailpit'] }), true))).toEqual(['mail']);
  });

  it('lets a service say for itself, either way', () => {
    const d = project({ services: { db: { recipe: 'mariadb', params: {}, shared: false }, cache: { recipe: 'redis', params: {}, shared: true } } });
    expect(shared(settleSharing(d, true))).toEqual(['cache']);
  });

  it("puts a project without a group in the machine's pool, and nothing shared in none", () => {
    expect(settleSharing(project({ shared: true }), undefined).shareGroup).toBe(DEFAULT_GROUP);
    expect(settleSharing(project({ shared: true, group: 'unei' }), undefined).shareGroup).toBe('unei');
    expect(settleSharing(project(), undefined).shareGroup).toBeUndefined();
  });

  it('names a server after its recipe and version, the defaults and the tenant’s params aside', () => {
    const defaults = { version: '11.4', db: 'app', user: 'app', persist: true };
    expect(serverName('mariadb', { version: '11.4', db: 'shop', user: 'shop', persist: true }, defaults, ['db', 'user'])).toBe('mariadb-11-4');
    expect(serverName('mariadb', { version: '10.11', db: 'app', user: 'app', persist: true }, defaults, ['db', 'user'])).toBe('mariadb-10-11');
    expect(serverName('mariadb', { version: '11.4', persist: false }, defaults)).toMatch(/^mariadb-11-4-[0-9a-f]{6}$/);
    expect(serverName('mailpit', {})).toBe('mailpit');
  });
});
