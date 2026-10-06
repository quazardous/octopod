/**
 * The PowerShell scripts a Windows user runs (setup.ps1, the tray) must parse — a stray
 * apostrophe in a single-quoted string broke setup.ps1 for everyone — and stay ASCII:
 * Windows PowerShell 5.1 reads a BOM-less file in the system code page, where the bytes of a
 * dash or a curly quote turn into quote characters of their own. Parsed by pwsh, skipped
 * where it is not installed.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCRIPTS = [...readdirSync(ROOT).map((f) => join(ROOT, f)), ...readdirSync(join(ROOT, 'bin')).map((f) => join(ROOT, 'bin', f))].filter((f) => f.endsWith('.ps1'));
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('the PowerShell scripts', () => {
  it('are found: setup.ps1 and the tray at least', () => {
    expect(SCRIPTS.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))).toEqual(expect.arrayContaining(['setup.ps1', 'bin/octopod-tray.ps1']));
  });

  it('are ASCII only, for Windows PowerShell 5.1', () => {
    for (const file of SCRIPTS) {
      const bad = readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => /[^\x00-\x7F]/.test(line))
        .map(([n]) => n);
      expect(bad, `${file}: non-ASCII on lines`).toEqual([]);
    }
  });

  it.skipIf(!hasPwsh)('parse', { timeout: 60_000 }, () => {
    const list = SCRIPTS.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
    const r = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', `foreach ($f in @(${list})) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); foreach ($x in $e) { "$($f):$($x.Extent.StartLineNumber): $($x.Message)" } }`],
      { encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim(), 'parse errors').toBe('');
  });
});
