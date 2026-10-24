# Commands

Commands run in a project's folder act on that project; elsewhere, name it
(`octopod status demo`). All but `shell` take `--json`: the same answers as the API, for a
program. What each answer holds is in [CONTRACT.md](./CONTRACT.md).

## A project

```sh
octopod up                    # start the edge if needed, then the project (registered the first time)
octopod up --instance 2       # the same project a second time, at demo-2.localhost
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

## The API

The same operations are an HTTP API on a unix socket (`octopod serve`, which the user
service runs; TCP with a token on Windows), for other tools: [CONTRACT.md](./CONTRACT.md).
