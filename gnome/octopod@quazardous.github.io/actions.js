/*
 * What the indicator runs: argv, never a shell string. Pure, no `gi://` import: a test
 * checks each command.
 */

/** octopod's own commands, after the argv that starts octopod (config.json's `argv`). */
export const COMMANDS = {
    up: (project) => ['up', project],
    down: (project) => ['down', project],
    edgeUp: () => ['edge', 'up'],
    edgeDown: () => ['edge', 'down'],
};

/** The API is octopod's systemd user service: the indicator starts it, it does not watch it. */
export const START_SERVICE = ['systemctl', '--user', 'start', 'octopod'];

/** The whole argv of an octopod command. */
export function octopodArgv(base, args) {
    return [...base, ...args];
}

/** How a command is named in a notice. */
export function describe(args) {
    return `octopod ${args.join(' ')}`;
}
