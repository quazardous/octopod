/**
 * The Windows tray's wording (bin/octopod-tray-look.ps1): free of WinForms, so it runs
 * here under pwsh — skipped where pwsh is not installed. What must hold: Docker off told
 * apart from the edge stopped, a tooltip within NotifyIcon's 63 characters, an action's
 * first error line in its balloon, and ASCII-only files for Windows PowerShell 5.1.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin');
const LOOK = join(BIN, 'octopod-tray-look.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

/** Runs `script` after the look file, and reads what it prints as JSON. */
function pwsh(script: string): unknown {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', `. '${LOOK}'; ${script} | ConvertTo-Json -Compress`], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

describe('the Windows tray', () => {
  it('keeps its files ASCII, and dot-sources its wording', () => {
    for (const f of ['octopod-tray.ps1', 'octopod-tray-look.ps1']) expect(readFileSync(join(BIN, f), 'utf8'), f).not.toMatch(/[^\x00-\x7F]/);
    expect(readFileSync(join(BIN, 'octopod-tray.ps1'), 'utf8')).toContain(". (Join-Path $PSScriptRoot 'octopod-tray-look.ps1')");
  });

  it.skipIf(!hasPwsh)('says whether the edge runs, and how many projects', () => {
    expect(pwsh(`Get-TrayLook @{ running = $true; port = 80 } '' @(@{ name = 'a' }) @{ version = '0.3.0' }`)).toEqual({
      up: true,
      dockerDown: false,
      line: 'The edge runs - 1 project',
      tooltip: 'octopod 0.3.0 - edge running, 1 project',
    });
    expect(pwsh(`(Get-TrayLook @{ running = $true; port = 8480 } '' @() $null).line`)).toBe('The edge runs on port 8480 - 0 projects');
    expect(pwsh(`Get-TrayLook @{ running = $false } '' @(@{ name = 'a' }, @{ name = 'b' }) $null`)).toMatchObject({ up: false, dockerDown: false, line: 'The edge is stopped - 2 projects' });
  });

  it.skipIf(!hasPwsh)('tells Docker not answering apart from octopod failing', () => {
    expect(pwsh(`Get-TrayLook $null 'docker: failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine' @() $null`)).toMatchObject({
      up: false,
      dockerDown: true,
      line: 'Docker does not answer: is Docker Desktop running?',
    });
    expect(pwsh(`Get-TrayLook $null "Error: Cannot find module 'tsx'\`nmore" @() $null`)).toMatchObject({ dockerDown: false, line: "octopod does not answer: Error: Cannot find module 'tsx'" });
  });

  it.skipIf(!hasPwsh)('keeps the tooltip within 63 characters', () => {
    const tip = pwsh(`Get-TrayTooltip 'octopod 10.20.30-rc.1' 'edge running, 123 projects, and much more to say than fits'`) as string;
    expect(tip.length).toBeLessThanOrEqual(63);
    expect(tip.endsWith('...')).toBe(true);
  });

  it.skipIf(!hasPwsh)('words an action: done, or its first error line', () => {
    expect(pwsh(`Get-ActionBalloon 'octopod up demo' 0 ''`)).toEqual({ ok: true, text: 'octopod up demo: done.' });
    expect(pwsh(`Get-ActionBalloon 'octopod up demo' 1 "\`noctopod: project demo is not registered\`nat x"`)).toEqual({ ok: false, text: 'octopod up demo failed: project demo is not registered' });
    expect(pwsh(`Get-ActionBalloon 'octopod edge up' 3 ''`)).toEqual({ ok: false, text: 'octopod edge up failed: exit code 3' });
    expect(pwsh(`Get-ProjectLabel @{ name = 'demo'; problem = 'broken octopod.yaml' }`)).toBe('demo (!)');
  });
});
