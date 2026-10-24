/**
 * The CLI's help, one entry per command: what `octopod help [command]` and `--help` print,
 * and the usage line an unknown command gets. A test holds it to the commands the CLI
 * answers. docs/COMMANDS.md is the guided tour; this is the reference at hand.
 */
export interface CommandHelp {
  usage: string;
  about: string;
  flags?: [string, string][];
}

const INSTANCE: [string, string] = ['--instance N', 'instance N of the project (octopod up --instance N); 1 by default'];
const JSON_FLAG: [string, string] = ['--json', 'the API\'s JSON, for a program'];

export const HELP: Record<string, CommandHelp> = {
  up: { usage: 'octopod up [project] [--instance N]', about: 'Start the edge if needed, then the project (the one declared here, registered the first time), or apply what changed.', flags: [INSTANCE, JSON_FLAG] },
  down: { usage: 'octopod down [project] [--volumes] [--instance N]', about: 'Stop the project: its containers go, its data stays.', flags: [['--volumes', "also remove Docker's volume objects (the data in .octopod/data stays)"], INSTANCE, JSON_FLAG] },
  status: { usage: 'octopod status [project] [--instance N]', about: "The project's services (state, health, programs), routes, the group's servers it uses with their addresses, and warnings.", flags: [INSTANCE, JSON_FLAG] },
  logs: { usage: 'octopod logs [project] [--service s] [--tail n]', about: "The project's logs, one service's or all.", flags: [['--service s', 'one service'], ['--tail n', 'the last n lines (200)'], INSTANCE] },
  restart: { usage: 'octopod restart [project] [--service s]', about: 'Restart the project, or one service.', flags: [['--service s', 'one service'], INSTANCE, JSON_FLAG] },
  plan: { usage: 'octopod plan [dir] [--instance N]', about: 'What up would run, writing nothing: each service, its image, the variables it gets and from where, its data, its address.', flags: [INSTANCE, JSON_FLAG] },
  register: { usage: 'octopod register [dir]', about: 'Declare a project without starting it.', flags: [JSON_FLAG] },
  unregister: { usage: 'octopod unregister <project>', about: 'Take its containers and images away; its data stays in its folder.' },
  list: { usage: 'octopod list [--group g] [--tag t]', about: 'The registered projects.', flags: [['--group g', 'those of a group'], ['--tag t', 'those carrying a tag'], JSON_FLAG] },
  shell: { usage: 'octopod shell [project] [service] [--root] [--oneshot] [-- command…]', about: "A shell in a running service, as its user, in its working folder; or a command, with a terminal.", flags: [['--root', 'as root'], ['--oneshot', 'in a fresh container of a service that is not running'], INSTANCE] },
  exec: { usage: 'octopod exec <project> <service> [--timeout ms] -- <argv…>', about: 'Run a command in a service, its output captured: an argv, never a shell string.', flags: [['--timeout ms', 'kill it past this'], INSTANCE, JSON_FLAG] },
  run: { usage: 'octopod run [project] <service> [<action> [file]] [--yes]', about: "A service's actions: a database's shell, dump, load, reset (a shared database's too, as the project's tenant), the project's own. Without an action, the list.", flags: [['--yes', 'confirm a destructive action (load, reset)'], INSTANCE] },
  ps: { usage: 'octopod ps [project]', about: 'The programs of the supervised services, with their state.', flags: [INSTANCE, JSON_FLAG] },
  program: { usage: 'octopod program start|stop|restart [project] <service>/<program> | reload [project] <service>', about: "Start, stop or restart one program; reload a service's supervisor_d folder.", flags: [INSTANCE] },
  secrets: { usage: 'octopod secrets [project] [--instance N]', about: "The secrets octopod generated for the project (passwords, the OIDC admin token): their names; with --json, the values.", flags: [INSTANCE, JSON_FLAG] },
  oidc: {
    usage: 'octopod oidc users [project] | user [project] <name> [--claims JSON] [--password p | --no-password] [--issuers a,b | --all-issuers] | remove [project] <name>',
    about: "The users of the project's OIDC provider, its own or its group's.",
    flags: [['--claims JSON', 'the claims it signs'], ['--password p', 'a password (--no-password: one-click sign-in)'], ['--issuers a,b', 'the issuers it may use (--all-issuers: any)'], JSON_FLAG],
  },
  recipes: { usage: 'octopod recipes [dir] [--check]', about: 'The recipes a project can name, and which folder each comes from.', flags: [['--check', "their Dockerfiles against octopod's rules"], JSON_FLAG] },
  share: { usage: 'octopod share [true | <recipe>… | --off]', about: "What every project shares with its group unless it says otherwise; without arguments, what is set.", flags: [['--off', 'nothing (the default)']] },
  edge: { usage: 'octopod edge up|down|status', about: "The edge (Traefik): start it, stop it, or say where it answers.", flags: [JSON_FLAG] },
  console: { usage: 'octopod console code|revoke', about: 'A code that enrolls a browser in the console; revoke signs every browser out.', flags: [JSON_FLAG] },
  setup: { usage: 'octopod setup [--no-service] [--no-edge] [--gnome-extension] [--mcp]', about: 'Check Docker, run the API as a user service, start the edge.', flags: [['--no-service', 'no user service'], ['--no-edge', 'do not start the edge'], ['--gnome-extension', 'octopod in the GNOME top bar'], ['--mcp', 'register octopod mcp with Claude Code']] },
  doctor: { usage: 'octopod doctor', about: 'What is wrong on this machine, and the command that puts each thing right.', flags: [JSON_FLAG] },
  uninstall: { usage: 'octopod uninstall [--purge]', about: 'Service, projects, edge and extension away; the data stays.', flags: [['--purge', "octopod's state too"]] },
  mcp: { usage: 'octopod mcp', about: 'An MCP server on stdio, for coding agents: the project of its folder, as tools.' },
  serve: { usage: 'octopod serve [--socket path]', about: 'The API, and the console\'s data (what the user service runs).', flags: [['--socket path', 'another socket']] },
  version: { usage: 'octopod version', about: "octopod's version, the contract it speaks and its features.", flags: [JSON_FLAG] },
  help: { usage: 'octopod help [command]', about: 'This help, or one command\'s.' },
};

/** The help of one command, or of all of them. */
export function helpText(command?: string): string {
  const one = command ? HELP[command] : undefined;
  if (command && !one) return `octopod: no command "${command}"\n\n${helpText()}`;
  if (one) {
    const flags = (one.flags ?? []).map(([f, d]) => `  ${f.padEnd(16)} ${d}`);
    return [`usage: ${one.usage}`, '', one.about, ...(flags.length ? ['', ...flags] : [])].join('\n');
  }
  const width = Math.max(...Object.keys(HELP).map((c) => c.length));
  return [
    'octopod: one local edge for every Docker project. In a project\'s folder, a command acts on that project.',
    '',
    ...Object.entries(HELP).map(([c, h]) => `  ${c.padEnd(width)}  ${h.about}`),
    '',
    'octopod help <command> for its usage and flags. Documentation: docs/COMMANDS.md.',
  ].join('\n');
}
