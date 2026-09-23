/*
 * What the indicator shows for what octopod says: pure functions, no `gi://` import, so
 * a test loads them outside the shell. The Windows tray says the same things
 * (bin/octopod-tray-look.ps1), and a test holds the two to it.
 */

/**
 * `edge`: GET /v1/edge, or null when it failed, with `why`, the error: Docker not
 * answering, most of the time. `projects`: GET /v1/projects. `version`: GET /v1/version.
 * `dockerHint`: what to check when Docker does not answer.
 */
export function trayLook(edge, why, projects, version, dockerHint = 'is the Docker service running?') {
    const v = version && version.version ? ` ${version.version}` : '';
    const count = (projects || []).filter(Boolean).length;
    const some = count === 1 ? '1 project' : `${count} projects`;
    if (!edge) {
        const docker = /docker|daemon|pipe|engine/i.test(why || '');
        const line = docker
            ? `Docker does not answer: ${dockerHint}`
            : why
                ? `octopod does not answer: ${String(why).split('\n')[0]}`
                : 'octopod does not answer';
        return {up: false, dockerDown: docker, line, title: `octopod${v}`};
    }
    if (!edge.running) return {up: false, dockerDown: false, line: `The edge is stopped - ${some}`, title: `octopod${v}`};
    const port = edge.port && edge.port !== 80 ? ` on port ${edge.port}` : '';
    return {up: true, dockerDown: false, line: `The edge runs${port} - ${some}`, title: `octopod${v}`};
}

/** A project's menu entry: its name, and a mark when it has a problem. */
export function projectLabel(project) {
    return project.problem ? `${project.name} (!)` : String(project.name);
}

/** A project's state in its submenu, from GET /v1/projects/:name. */
export function projectState(status) {
    const services = (status.services || []).filter((s) => s.state !== 'tool');
    const running = services.filter((s) => s.state === 'running').length;
    if (services.length === 0) return 'down';
    const warnings = (status.warnings || []).length;
    return `${running}/${services.length} running${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`;
}

/** The notice after an action the indicator ran (`octopod up demo`...): done, or its first error line. */
export function actionNotice(what, exitCode, stderr) {
    if (exitCode === 0) return {ok: true, text: `${what}: done.`};
    const first = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return {ok: false, text: `${what} failed: ${first ? first.replace(/^octopod: /, '').trim() : `exit code ${exitCode}`}`};
}
