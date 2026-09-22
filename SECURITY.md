# Security

## Reporting a vulnerability

Report it privately, through GitHub: the repository's **Security** tab, then **Report a
vulnerability** (a private security advisory). Please do not open a public issue for it.

Say what an attacker can do, from where (another local user, a container, a web page,
a recipe), and how to reproduce it. You will get an answer, and a fix will be released
with a `Security` entry in the changelog; you will be credited unless you ask otherwise.

## Supported versions

octopod is in 0.x: only the latest release gets fixes.

## Threat model

octopod runs on a developer's machine, as that developer, for projects the developer
chose to run. It holds them to a few boundaries; these are in scope.

**The API socket.** The API is HTTP over a unix socket,
`$XDG_RUNTIME_DIR/octopod/octopod.sock`, created `0600` in a folder made `0700`: only the
user who runs octopod can reach it. It has no other authentication, and needs none, since
whoever can reach it can already use Docker as that user. There is no TCP listener.

**The edge.** The shared Traefik publishes on loopback only (`127.0.0.1`, port 80 or
8480): nothing on the network reaches it. It only routes containers labelled
`octopod.edge=<its instance>`, so a container of another tool, even one labelled
`traefik.enable=true`, is never exposed by it — nor is another octopod edge's.

**The edge's own pages** — the web console (`http://octopod.localhost`) and Traefik's
dashboard (`http://traefik.localhost`) — answer only from the host. A Traefik
`ipAllowList` lets through the edge's own network, where the host's requests arrive through
the published port; a project's container, which reaches the edge over its edge network,
gets a 403. The console is read-only: a relay (nginx, running as the operator, read-only
root, no capability) passes GET and HEAD to the API's socket and refuses every other
method, and the page is served with a strict Content Security Policy. Everything it shows
comes from the projects (names, log lines) and is rendered as text, never as markup.

**The Docker socket** is mounted read-only into Traefik, which needs it to discover
containers. Read-only does not mean harmless: `:ro` only stops the socket file from being
replaced; every Docker API call, starting a privileged container included, still goes
through it. Whoever takes control of the Traefik container controls Docker, which is root
on the host. That is why the Traefik image is pinned to an exact version, why the edge
publishes on loopback only, and why a way to reach the Docker API through the edge is a
vulnerability.

**Project isolation.** Each project has its own edge network,
`octopod-<project>-edge`, created `internal`, and only the shared Traefik joins them all.
A project's containers cannot reach another project's through octopod. A project serves
only `<project>.localhost` and names under it: it cannot take another project's host.
docker gets only what it needs of octopod's own environment, so a variable of the calling
shell never flows into a project's compose file unseen.

**Recipes build images.** A recipe is a `recipe.yaml` and a `Dockerfile` that octopod
builds on your machine, with your uid. A project cannot give a recipe an image, a flag or
a path, only typed parameters, and the build context holds the Dockerfile alone. But a
recipe from a third party (`OCTOPOD_RECIPES`, `recipes:` in `octopod.yaml`, a project's
`.octopod/recipes/`) runs whatever its Dockerfile says: review it like code before you use
it. `octopod plan` shows what would run, with each recipe's digest, before anything does.

**Generated secrets** (a database password, for instance) are generated once, kept in
octopod's state directory (`$XDG_STATE_HOME/octopod`, by default `~/.local/state/octopod`)
in files of mode `0600`, and never written into the project. A local client can read
their values (`octopod secrets --json`, or the API on the socket) to mask them; the
console's relay refuses that route.

## Out of scope

- What runs inside a project's containers, and what its own compose files do: octopod
  composes them, it does not sandbox them. A compose file can mount the host or run
  privileged; running a project means trusting it.
- Anyone who already has the user's account or Docker access.
- Exposure beyond the machine: octopod serves `*.localhost` on loopback, for development.
