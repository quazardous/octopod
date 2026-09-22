# Contributing

Thank you for looking. octopod is small on purpose: an infrastructure provider, Traefik
and Docker composition, nothing more. A change that keeps it that way is the easiest to
accept. For anything larger than a fix, open an issue first and say what you need.

## Set up from a clone

Requires Docker with Compose v2 (`docker compose`) and Node 22.

```sh
./setup.sh              # dependencies, `octopod` linked into ~/.local/bin, the edge started
./setup.sh --no-edge    # … without starting the edge
```

Or by hand, without touching your PATH:

```sh
npm ci
bin/octopod edge status
```

`bin/octopod` runs the TypeScript sources through tsx: there is no build step, and a
change to `src/` is live on the next command.

Enable the repository's hooks once, so a commit that would leak something is refused:

```sh
git config core.hooksPath .githooks
```

## Checks

```sh
npm run typecheck                                        # tsc --noEmit, strict
npx vitest run --exclude '**/*.integration.test.ts'      # unit tests: no Docker needed
npx vitest run src/docker.integration.test.ts            # against real Docker
npm run check:leaks                                      # home paths, ticket refs, secrets
```

The integration tests run two projects behind a real edge. They use their own instance
prefix (`octopodtest`) and port (18480), so they never touch your own edge or projects,
and they are skipped when Docker does not answer. Two runs at the same time on one
machine collide with each other, though: run one at a time.

`npm test` runs everything, integration tests included. CI runs the three jobs above on
every push and pull request.

`npm run check:leaks` scans the tracked files; `scripts/check-leaks.sh --history` scans
every commit too. It runs gitleaks as well when gitleaks is installed.

## Style

Read a few files of `src/` before writing: the conventions are consistent, and a change
that follows them is easier to review.

- **English everywhere**: code, comments, docs, commit messages. The repository is public.
- **Comments say why**, not what. A comment explains the trap a line avoids or the rule it
  holds (why the Docker socket is read-only, why the environment passed to docker is
  filtered); the code already says what it does.
- **Docker is called with an argument array, never a shell string.** `src/docker.ts` runs
  `execFile` with `string[]`; nothing octopod builds goes through a shell. The API's
  `exec` takes `argv: string[]` for the same reason.
- **Generators are pure.** `src/generate.ts` (the Traefik configuration, the edge's
  compose file, a project's override and labels) and `src/recipes/render.ts` are functions
  of their inputs, with no Docker and no file system, and are tested that way
  (`generate.test.ts`, `recipes.test.ts`). Behaviour that depends on Docker goes into
  `docker.integration.test.ts`, against real Docker, not a mock.
- **Nothing is written into a project but `.octopod/`.** The generated override and the
  secrets live in octopod's state directory.
- **Test names are sentences** about the behaviour: `it('refuses a moving tag unless the
  recipe says so, …')`.
- Errors say what went wrong and what to do: a user reads them in a terminal.

TypeScript is strict, ES modules, Node 22; no framework, few dependencies (`yaml`,
`zod`). Adding a dependency needs a reason.

## Changelog

[CHANGELOG.md](./CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every notable change adds a line under `## [Unreleased]`, in the right section (`Added`,
`Changed`, `Fixed`, `Removed`, `Security`), written for a user of octopod, not for its
developers. A change that breaks what [docs/CONTRACT.md](./docs/CONTRACT.md) promises (the
declaration, the generated labels, the API, the CLI's JSON) says so in a **Breaking** note
and updates the contract in the same change.

## Recipes

A recipe is a folder under `recipes/`: a `recipe.yaml`, and a `Dockerfile` when it builds
(see [Recipes](./docs/CONTRACT.md#recipes) in the contract, and `src/recipes/recipe.ts` for
every field). To propose one:

- open an issue with the recipe template first: what it runs, and why it belongs in
  octopod rather than in a folder of your own (`OCTOPOD_RECIPES`, or `recipes:` in a
  project's `octopod.yaml`, serve that without any change here);
- start the file with a comment that says what the service is and how a project reaches
  it, like the built-in ones;
- pin the image tag; a moving tag needs `unpinned: true`, visibly;
- follow the conventions: data in a named volume (bound to the project's `.octopod/data/`),
  nothing owned by root (a built image's user moved to the operator's uid, as `node-app`
  does), no dependency installed in an image, secrets as `type: secret` parameters;
- add a test to `src/recipes/recipes.test.ts` for what the recipe renders.

A recipe builds an image on the user's machine: it is reviewed like code.
