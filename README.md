# octopod

> One local edge for all your Docker projects: a shared Traefik, declared projects and isolated networks — behind a small API.

Every Docker project on a development machine tends to grow its own Traefik, its own
labels, its own `.env` conventions — and they fight over port 80, adopt each other's
routes, and repeat the same traps. octopod does that part once, for the whole machine:

- **one shared Traefik**, on loopback, serving `http://<project>.localhost`, that only
  sees the containers octopod labelled;
- **projects declare themselves** in a small file next to their own
  `docker-compose.yml`; octopod generates the compose override that carries the
  labels, the routing rules and the networks — projects stop writing Traefik labels;
- **projects are isolated from each other**: each has its own edge network, and the
  shared Traefik is connected to each;
- **an API** (JSON over a unix socket) and a CLI that speaks it, so any project — PHP,
  Python, Node — and any tool can use it.

octopod is only that: Traefik and Docker composition. It knows nothing about what runs in
the containers or what their environment files hold — secrets and the like are the
business of the tools that use it.

Status: MVP. Its first client is bushwhack. See [docs/ROADMAP.md](./docs/ROADMAP.md),
[docs/CONTRACT.md](./docs/CONTRACT.md) and [docs/PATTERNS.md](./docs/PATTERNS.md).

## Use

Requires Docker with Compose v2 (`docker compose`) and Node 22.

Next to a project's `docker-compose.yml`, an `octopod.yaml`:

```yaml
project: demo
expose:
  - service: web
    port: 3000          # → http://demo.localhost
  - service: api
    port: 8080
    host: api           # → http://api.demo.localhost
```

```sh
octopod register            # in the project folder
octopod up                  # starts the edge if needed, then the project
octopod status              # services and URLs
octopod logs --service web --tail 100
octopod down                # --volumes to drop them too
octopod edge status         # the shared Traefik; dashboard at http://traefik.localhost
octopod serve               # the JSON API on a unix socket, for other tools
```

The edge listens on `127.0.0.1:80`, or `127.0.0.1:8480` when 80 is taken; URLs carry
the port then.

**Networks.** Each project gets its own edge network, and octopod attaches the shared
Traefik to it on `up` and detaches it on `down`. Bring projects down through octopod: a
plain `docker compose down` cannot remove a network the edge is still attached to.

## License

MIT. See [LICENSE](./LICENSE).
