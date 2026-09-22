# Examples

Each folder is a project octopod can run as it is. From one of them:

```sh
octopod register && octopod up
octopod status
octopod down
```

| Example | Shows |
|---|---|
| [`whoami`](./whoami) | A project with its own compose file: two services on two hosts, `whoami.localhost` and `api.whoami.localhost`. |
| [`node-postgres`](./node-postgres) | A project with no compose file and no Dockerfile: a Node app and a PostgreSQL database, from recipes. |

Run a project twice with `octopod up --instance 2`: the second copy is served at
`whoami-2.localhost`, on its own networks, with its own data.
