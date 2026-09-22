/**
 * octopod — the command line. The same operations as the API, run in-process; `serve`
 * starts the API for other tools.
 *
 *   octopod edge up|down|status
 *   octopod register [dir]
 *   octopod up|down|status|logs [project] [--service s] [--tail n] [--volumes]
 *   octopod unregister <project>
 *   octopod list
 *   octopod serve [--socket path]
 *
 * `--json` prints the API's JSON; otherwise a short human summary.
 */
import { basename, resolve } from 'node:path';
import { loadDeclaration } from './declaration.js';
import { defaultSocket, listen } from './api.js';
import { Octopod, type EdgeStatus, type Project, type ProjectStatus } from './octopod.js';

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function print(value: unknown, json: boolean): void {
  if (json) return console.log(JSON.stringify(value, null, 2));
  const edge = value as EdgeStatus;
  if ('running' in (value as object) && 'dashboard' in (value as object)) {
    console.log(edge.running ? `edge running on 127.0.0.1:${edge.port} — dashboard ${edge.dashboard}` : 'edge stopped');
    return;
  }
  const projects = (Array.isArray(value) ? value : [value]) as (Project | ProjectStatus)[];
  for (const p of projects) {
    console.log(`${p.name}  ${p.root}`);
    for (const r of p.routes) console.log(`  ${r.service} → ${r.url}`);
    for (const s of (p as ProjectStatus).services ?? []) console.log(`  [${s.state}${s.health ? `, ${s.health}` : ''}] ${s.service}`);
  }
}

const VALUED = new Set(['--service', '--tail', '--socket', '--timeout', '--instance']);

/** `--instance N`: instance N of the project (`<project>-N`); 1, the project itself, by default. */
function instanceOf(args: string[]): number {
  const raw = flag(args, '--instance');
  const n = raw === undefined ? 1 : Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--instance takes a number from 1, not ${raw}`);
  return n;
}

/** Arguments that are neither flags nor a flag's value. */
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUED.has(args[i])) i++;
    else if (!args[i].startsWith('--')) out.push(args[i]);
  }
  return out;
}

/** The project named on the command line, or the one declared in the current folder. */
async function projectName(args: string[]): Promise<string> {
  return positional(args)[0] ?? (await loadDeclaration(process.cwd())).project;
}

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  const [command, ...rest] = argv.filter((a) => a !== '--json');
  const octopod = new Octopod();
  switch (command) {
    case 'edge': {
      const sub = positional(rest)[0] ?? 'status';
      if (sub === 'up') return print(await octopod.edgeUp(), json);
      if (sub === 'down') return print(await octopod.edgeDown(), json);
      return print(await octopod.edgeStatus(), json);
    }
    case 'register':
      return print(await octopod.register(resolve(positional(rest)[0] ?? '.')), json);
    case 'list':
      return print(await octopod.list(), json);
    case 'up':
      return print(await octopod.up(await projectName(rest), instanceOf(rest)), json);
    case 'down':
      return print(await octopod.down(await projectName(rest), { volumes: rest.includes('--volumes'), instance: instanceOf(rest) }), json);
    case 'status':
      return print(await octopod.status(await projectName(rest), instanceOf(rest)), json);
    case 'logs': {
      const lines = await octopod.logs(await projectName(rest), flag(rest, '--service'), Number(flag(rest, '--tail') ?? 200), instanceOf(rest));
      return json ? print({ lines }, true) : console.log(lines.join('\n'));
    }
    case 'restart':
      return print(await octopod.restart(await projectName(rest), flag(rest, '--service'), instanceOf(rest)), json);
    case 'exec': {
      // octopod exec <project> <service> [--timeout ms] -- <command...>
      const dash = rest.indexOf('--');
      if (dash < 0) throw new Error('usage: octopod exec <project> <service> [--timeout ms] -- <command...>');
      const [project, service] = positional(rest.slice(0, dash));
      if (!project || !service) throw new Error('usage: octopod exec <project> <service> [--timeout ms] -- <command...>');
      const result = await octopod.exec(project, service, rest.slice(dash + 1), { timeoutMs: Number(flag(rest.slice(0, dash), '--timeout') ?? 60_000), instance: instanceOf(rest.slice(0, dash)) });
      if (json) return print(result, true);
      process.stdout.write(result.output);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case 'unregister':
      if (!positional(rest)[0]) throw new Error('usage: octopod unregister <project>');
      await octopod.unregister(positional(rest)[0]);
      return print({}, json);
    case 'serve': {
      const socket = flag(rest, '--socket') ?? defaultSocket();
      await listen(octopod, socket);
      console.log(`octopod API on ${socket}`);
      return;
    }
    default:
      console.log(`usage: ${basename(process.argv[1] ?? 'octopod')} edge up|down|status | register [dir] | list | up|down|status|logs [project] | unregister <project> | serve  [--json]`);
      if (command) process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(`octopod: ${(e as Error).message}`);
  process.exit(1);
});
