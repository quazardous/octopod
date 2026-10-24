# Commands

Commands run in a project's folder act on that project; elsewhere, name it
(`octopod status demo`). `octopod help [command]` (or `--help`) gives each one's usage and
flags. All but `shell` take `--json`: the same answers as the API, for a
program. What each answer holds is in [CONTRACT.md](./CONTRACT.md).

## A project

```sh
octopod up                    # start the edge if needed, then the project (registered the first time)
octopod up --instance 2       # the same project a second time, at demo-2.octopod.localhost
octopod status                # its services, URLs and warnings
octopod logs --service web --tail 100
octopod restart [--service s]
octopod down                  # --volumes removes Docker's volume objects; the data stays
octopod plan [dir]            # what up would run, before anything does
octopod register [dir]        # declare a project without starting it
octopod unregister <project>  # its containers and images away; its data stays
octopod list --group shop     # the registered projects (--tag php, too)
```

## Inside it

```sh
octopod shell [service]       # a shell in a service, as its user; --root; -- command…
octopod exec <project> <service> -- <argv…>   # a command, its output captured
octopod run db dump > dump.sql   # a service's actions: shell, dump, load, reset for a database
octopod ps                    # the programs of its supervised services
octopod program start app/seed
octopod secrets [project]     # the secrets octopod generated for it (passwords, the OIDC admin token)
octopod oidc users            # the users of its OIDC provider; user <name> --group g --attr k=v; groups; group add <g>
octopod oidc session ada --url <app sign-in>   # the app signed in as ada, no password: its cookies; link: a URL for a browser; token
```

## The machine

```sh
octopod setup                 # checks Docker, runs the API as a user service, starts the edge
octopod edge status           # the edge, the console and the dashboard's addresses
octopod console code          # a code that enrolls a browser in the console; revoke signs every one out
octopod share true            # what every project shares with its group (SHARING.md); --off
octopod recipes [--check]     # the recipes a project can name; their Dockerfiles against the rules
octopod doctor                # what is wrong on this machine, and the command that fixes each thing
octopod uninstall [--purge]   # service, projects, edge, extension away; data stays; --purge: the state too
octopod version
```

## For a coding agent

```sh
octopod setup --mcp           # registers `octopod mcp` with Claude Code, for every folder
```

`octopod mcp` is an MCP server on stdio: the project is the one declared in the agent's
folder (the nearest `octopod.yaml` up the tree), or the one a tool names. Its tools:
`octopod_status`, `octopod_logs` (with a `match`), `octopod_plan`, `octopod_exec` (an argv,
never a shell string), `octopod_run` (a service's action; load and reset need `confirm`),
`octopod_up` (a long build answers "still running" and goes on), `octopod_down` (`volumes`
needs `confirm`), `octopod_restart`. Secrets, shells and the edge are not offered: they stay
the human's. Another client registers the same command: `octopod mcp`, run in the project's
folder.

## The API

The same operations are an HTTP API on a unix socket (`octopod serve`, which the user
service runs; TCP with a token on Windows), for other tools: [CONTRACT.md](./CONTRACT.md).
