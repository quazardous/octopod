/**
 * What a recipe's Dockerfile should keep to, checked from its text (`octopod recipes --check`).
 * A help for whoever writes a recipe, not a gate: a Dockerfile can do anything a static read
 * cannot see, and `octopod status` reports what actually runs as root.
 */

/** Installing a project's dependencies: the project's job, in the running container. */
export const PROJECT_DEPS = /\b(npm (install|ci)|yarn( install)?\b|pnpm (install|i)\b|pip3? install|composer (install|update|require)|bundle install)/;

interface Instruction {
  line: number;
  keyword: string;
  args: string;
}

/** The instructions, continuation lines joined, comments and heredoc bodies left out. */
function instructions(text: string): Instruction[] {
  // A Dockerfile written on Windows ends its lines with CRLF.
  const lines = text.split(/\r?\n/);
  const out: Instruction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    while (/\\\s*$/.test(line) && i + 1 < lines.length) {
      i++;
      if (/^\s*#/.test(lines[i])) continue;
      line = `${line.replace(/\\\s*$/, ' ')}${lines[i]}`;
    }
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!m) continue;
    out.push({ line: start + 1, keyword: m[1].toUpperCase(), args: m[2].trim() });
    // A heredoc's body is a file's content, not instructions.
    for (const h of line.matchAll(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g)) {
      while (i + 1 < lines.length && lines[i + 1].trim() !== h[1]) i++;
      i++;
    }
  }
  return out;
}

/** What the Dockerfile does against octopod's rules, one sentence each; empty when nothing. */
export function lintDockerfile(text: string): string[] {
  const problems: string[] = [];
  const all = instructions(text);
  const froms = all.filter((x) => x.keyword === 'FROM');
  const last = froms.at(-1);
  if (!last) problems.push('no FROM');
  else if (!/^\$\{?BASE_IMAGE\}?(\s+AS\s+\S+)?$/i.test(last.args)) {
    problems.push(`line ${last.line}: the final stage starts FROM ${last.args}, not FROM \${BASE_IMAGE}: the recipe's image and the project's params choose the base`);
  }
  for (const x of all) {
    if (x.keyword === 'VOLUME') problems.push(`line ${x.line}: VOLUME — octopod keeps data in the project's .octopod/data from the recipe's volumes; an anonymous volume escapes it`);
    if ((x.keyword === 'COPY' || x.keyword === 'ADD') && !/--from=/.test(x.args) && !/<</.test(x.args)) {
      problems.push(`line ${x.line}: ${x.keyword} ${x.args} — the build context is the Dockerfile alone: copy from a stage (--from=) or write the file inline (a heredoc)`);
    }
    if (x.keyword === 'RUN' && PROJECT_DEPS.test(x.args)) {
      problems.push(`line ${x.line}: RUN installs a project's dependencies — they are the project's, installed in the running container`);
    }
  }
  const afterLast = last ? all.filter((x) => x.line > last.line) : [];
  const user = afterLast.filter((x) => x.keyword === 'USER').at(-1);
  // No USER is not flagged: a database image's entrypoint starts as root and drops to its own
  // user by itself. What really runs as root, `octopod status` reads from the process.
  if (user && /^(root|0)(:.*)?$/.test(user.args)) problems.push(`line ${user.line}: the last USER is ${user.args} — what the container writes in the project would be root's`);
  return problems;
}
