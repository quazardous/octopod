#!/usr/bin/env node
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
 *   octopod shell [project] [service] [--root] [--oneshot] [-- command…]
 *   octopod secrets [project] [--instance N]
 *   octopod recipes [dir] [--check]
 *   octopod version
 *   octopod setup [--no-service] [--no-edge]
 *
 * `--json` prints the API's JSON; otherwise a short human summary.
 */
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { dockerEnv } from './docker.js';
import { loadDeclaration } from './declaration.js';
import { listen } from './api.js';
import { setup } from './setup.js';
import { Octopod, version, type EdgeStatus, type Project, type ProjectStatus } from './octopod.js';

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function print(value: unknown, json: boolean): void {
  if (json) return console.log(JSON.stringify(value, null, 2));
  const edge = value as EdgeStatus;
  if ('running' in (value as object) && 'dashboard' in (value as object)) {
    console.log(edge.running ? `edge running on 127.0.0.1:${edge.port} — console ${edge.console}, Traefik dashboard ${edge.dashboard}` : 'edge stopped');
    return;
  }
  const projects = (Array.isArray(value) ? value : [value]) as (Project | ProjectStatus)[];
  for (const p of projects) {
    const labels = [p.group ? `[${p.group}]` : '', ...(p.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' ');
    console.log(`${p.name}  ${p.root}${labels ? `  ${labels}` : ''}`);
    if (p.problem) console.log(`  ! ${p.problem}`);
    for (const r of p.routes) console.log(`  ${r.service} → ${r.url}`);
    for (const s of (p as ProjectStatus).services ?? []) console.log(`  [${s.state}${s.health ? `, ${s.health}` : ''}] ${s.service}`);
  }
}

const VALUED = new Set(['--service', '--tail', '--socket', '--timeout', '--instance', '--group', '--tag']);

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
  // The socket `serve` listens on is the one the edge's console relays to.
  const socket = flag(rest, '--socket');
  const octopod = new Octopod(socket ? { socket: resolve(socket) } : {});
  switch (command) {
    case 'version':
    case '--version': {
      const v = await version();
      return json ? print(v, true) : console.log(`octopod ${v.version} (contract ${v.contract})`);
    }
    case 'shell': {
      // octopod shell [project] [service] [--instance N] [--root] [--oneshot] [-- command…]
      const dash = rest.indexOf('--');
      const before = dash < 0 ? rest : rest.slice(0, dash);
      const words = positional(before);
      // One word: a registered project, or a service of the project declared here.
      let project: string;
      let service: string | undefined;
      if (words.length >= 2) [project, service] = words;
      else if (words.length === 1 && !(await octopod.names()).includes(words[0])) [project, service] = [await projectName([]), words[0]];
      else project = await projectName(words);
      const argv = await octopod.shellCommand(project, {
        service,
        instance: instanceOf(before),
        root: before.includes('--root'),
        oneshot: before.includes('--oneshot'),
        command: dash < 0 ? undefined : rest.slice(dash + 1),
        tty: Boolean(process.stdin.isTTY),
      });
      // The terminal is handed to docker; its exit code becomes this command's.
      const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: { ...dockerEnv(), ...(process.env.TERM ? { TERM: process.env.TERM } : {}) } });
      process.exitCode = await new Promise<number>((done, fail) => {
        child.once('error', fail);
        child.once('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
      });
      return;
    }
    case 'secrets': {
      // octopod secrets <project> [--instance N]: the names; with --json, the values, for a
      // client to mask them. Never the values on a screen.
      const name = await projectName(rest);
      const raw = flag(rest, '--instance');
      const secrets = await octopod.secrets(name, raw === undefined ? undefined : instanceOf(rest));
      if (json) return print({ values: [...new Set(secrets.map((s) => s.value))] }, true);
      for (const s of secrets) console.log(`${s.project} ${s.service}.${s.name}`);
      if (secrets.length === 0) console.log(`no secret generated for ${name}`);
      return;
    }
    case 'setup':
      return setup(octopod, { service: !rest.includes('--no-service'), edge: !rest.includes('--no-edge'), log: (l) => console.log(l) });
    case 'edge': {
      const sub = positional(rest)[0] ?? 'status';
      if (sub === 'up') return print(await octopod.edgeUp(), json);
      if (sub === 'down') return print(await octopod.edgeDown(), json);
      return print(await octopod.edgeStatus(), json);
    }
    case 'register':
      return print(await octopod.register(resolve(positional(rest)[0] ?? '.')), json);
    case 'list':
      return print(await octopod.list({ group: flag(rest, '--group'), tag: flag(rest, '--tag') }), json);
    case 'up': {
      // No name: the project declared here, registered first if it is not yet (a fresh clone).
      let name = positional(rest)[0];
      if (!name) {
        const found = await octopod.ensureRegistered(process.cwd());
        if (found.registered) console.error(`registered ${found.name} from ${process.cwd()}`);
        name = found.name;
      }
      return print(await octopod.up(name, instanceOf(rest)), json);
    }
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
    case 'recipes': {
      // octopod recipes [dir]: the recipes a project in that folder (or any) can name.
      // --check: each built recipe's Dockerfile against octopod's rules; exit 1 on a problem.
      const dir = positional(rest)[0];
      if (rest.includes('--check')) {
        const checked = await octopod.checkRecipes(dir ? resolve(dir) : undefined);
        if (checked.recipes.some((r) => r.problems.length > 0)) process.exitCode = 1;
        if (json) return print(checked, true);
        for (const r of checked.recipes) {
          console.log(`${r.problems.length ? '!' : '✓'} ${r.id}  (${r.dir})`);
          for (const p of r.problems) console.log(`  ${p}`);
        }
        return;
      }
      const out = await octopod.recipes(dir ? resolve(dir) : undefined);
      if (json) return print(out, true);
      for (const r of out.recipes) console.log(`${r.id.padEnd(16)} ${r.title}  (${r.dir}, ${r.digest})`);
      for (const h of out.shadowed) console.log(`! ${h.id} in ${h.dir} is hidden by ${h.by}`);
      return;
    }
    case 'plan': {
      // octopod plan [dir]: what up would run for that folder's octopod.yaml. Writes nothing.
      const out = await octopod.plan(resolve(positional(rest)[0] ?? '.'), instanceOf(rest));
      return json ? print(out, true) : console.log(out.text);
    }
    case 'unregister':
      if (!positional(rest)[0]) throw new Error('usage: octopod unregister <project>');
      await octopod.unregister(positional(rest)[0]);
      return print({}, json);
    case 'serve': {
      await listen(octopod, octopod.socket);
      const edge = await octopod.edgeStatus();
      console.log(`octopod API on ${octopod.socket}${edge.console ? ` — console ${edge.console}` : ''}`);
      return;
    }
    default:
      console.log(`usage: ${basename(process.argv[1] ?? 'octopod')} edge up|down|status | register [dir] | list | up|down|status|logs [project] | unregister <project> | shell [project] [service] | serve | setup | version  [--json]`);
      if (command) process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(`octopod: ${(e as Error).message}`);
  process.exit(1);
});
