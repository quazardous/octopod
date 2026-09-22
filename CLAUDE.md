# Rules for coding agents

octopod is one local Traefik edge for all Docker projects, behind a small API. Read
README.md, docs/CONTRACT.md and CONTRIBUTING.md before changing anything.

**English everywhere.** Code, comments, docs, commit messages and CHANGELOG entries are in
English: the repository is public, and every reader must be able to follow it.

**No private references.** No absolute paths of a machine (`/home/<name>/…`), no ticket
numbers of a private tracker, no internal hostnames, no secrets, in files or commit
messages. A stranger reads them without the context, and they cannot be taken back once
pushed. Run `npm run check:leaks` before committing; the hook in `.githooks/` does it on
staged content.

**A CHANGELOG entry for every notable change**, under `## [Unreleased]` (Keep a Changelog),
written for a user of octopod. The changelog is how users learn what changed without
reading the diff.

**Tests.** Generators (`src/generate.ts`, `src/recipes/`) are pure functions, tested by unit
tests without Docker. Behaviour that involves Docker is tested against real Docker in
`src/docker.integration.test.ts`, not with mocks: the traps octopod exists for (networks,
labels, ports, ownership) only show up in the real thing. Run `npm run typecheck` and the
unit tests before committing.

**Never a shell string for docker.** Docker is run with an argument array (`execFile`,
`string[]`), and `exec` takes an `argv` array. A shell string built from a project name, a
path or a user's command is an injection waiting to happen.

**Nothing written into a project but `.octopod/`.** The project's folder belongs to its
owner: octopod keeps its own files (overrides, secrets, state) in its state directory, and
only data folders and rendered recipes go into the project's `.octopod/`, git-ignored.

**The contract is what clients rely on.** docs/CONTRACT.md describes the declaration, the
generated labels, the API and the CLI's JSON. Change it together with the code, and a
change that breaks it needs a **Breaking** note in the CHANGELOG: clients upgrade by
reading it.

**Keep the tone of the existing docs.** Plain, precise sentences that say what happens and
why; no marketing, no filler. Comments explain why, not what.
