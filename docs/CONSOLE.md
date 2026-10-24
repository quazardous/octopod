# The console

![The console: two projects, their services, states and routes](./console.png)

`http://octopod.localhost` shows every project as a tile: its state, the services running,
its warnings and its URLs, grouped by `group`. A project run more than once is one stacked
tile, a dot per instance. A project's page has its instances, the state and health of each
service and its programs, what octopod warns about, and the logs, which it refreshes.

A project's known services show as small icons of their software (an envelope for the mail
catcher), in their state's colour: a click opens what each serves — the OIDC admin, the
mail inbox, and for a database the admin wired to it. Only the app's URLs are listed.

It brings a project up or down; Down asks for a second click. The rest (`restart`, `exec`,
`run`, removing volumes) stays on the command line. It links to Traefik's dashboard at
`http://traefik.localhost`.

## Who may see it

Both answer only from your machine, never from a project's container. And the console shows
nothing to a browser you have not enrolled: the first time, it opens on a login page. Run
`octopod console code` (or *Console code* in the tray's or the GNOME extension's menu, which
copies it) and paste the code there, valid 10 minutes and once. The browser stays enrolled
for 30 days, or until *Sign out*. `octopod console revoke` signs every browser out.

## What it needs

The console reads octopod's API, which `octopod setup` runs as the `octopod` systemd user
service (on Windows, the tray runs it). When the API is not running, the console says how to
start it; `octopod doctor` says what else is wrong.

## In the desktop

- **GNOME:** `octopod setup --gnome-extension` puts octopod in the top bar: the projects and
  their URLs, up and down, the edge, the console, a console code. It shows after you log out
  and in again.
- **Windows:** `setup.ps1` puts the same in the notification area ([WINDOWS.md](./WINDOWS.md)).
