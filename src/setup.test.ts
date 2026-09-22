import { describe, it, expect } from 'vitest';
import { serviceCommand, serviceUnit } from './setup.js';

describe('the user service', () => {
  it('starts the very octopod that set it up: node, its flags, its entry point', () => {
    expect(serviceCommand('/usr/bin/node', ['--import', 'file:///o/tsx.mjs'], '/o/src/cli.ts')).toEqual(['/usr/bin/node', '--import', 'file:///o/tsx.mjs', '/o/src/cli.ts', 'serve']);
  });

  it('quotes every word of the command, a path with a space included, and keeps the PATH', () => {
    const unit = serviceUnit(['/usr/bin/node', '/opt/my apps/octopod/dist/cli.js', 'serve'], '/usr/local/bin:/usr/bin');
    expect(unit).toContain('ExecStart="/usr/bin/node" "/opt/my apps/octopod/dist/cli.js" "serve"');
    expect(unit).toContain('Environment="PATH=/usr/local/bin:/usr/bin"');
    expect(unit).toContain('WantedBy=default.target');
  });
});
