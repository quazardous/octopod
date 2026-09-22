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

Status: just started. See [docs/ROADMAP.md](./docs/ROADMAP.md).

## License

MIT. See [LICENSE](./LICENSE).
