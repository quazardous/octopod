# The console

![The console: two projects, their services, states and routes](./console.png)

`http://octopod.localhost` shows every project as a tile: its state, its warnings, its apps
and what they use. A group is one tile: the servers its projects share in its head, then each
project's apps; it opens on the group's page, the same view and each project in full. A
project run more than once is one stacked tile, a dot per instance. A project's page has its
instances, its apps, every container in a table (state, health, programs), what each
instance takes on disk, in all and by service beside its logs (image, data, temporary
files, code), what octopod
warns about, and the logs, which it refreshes.

A project is drawn as it is made. Each app comes with its address and the icons of its own
services it uses (its cache, its database); the servers it shares with its group show once,
at the group's level. A group's shared services are not a tile of their own. An icon is the
software's, in its colours: greyed when stopped, with a dot when in trouble. A click opens
what it serves — the OIDC admin, the mail inbox, a cache's keys, and for a database the
admin wired to it, which its icon stands for. An app's icon opens its info page, a phpinfo
of what runs in it (its runtime, packages, environment, programs), or where the project
says (`link: /__debug__/` on the service).

It brings a project, or a group's projects, up or down; Down asks for a second click. On a
project's page, two levels of cleaning. *Prune* empties an instance's caches, temporary
folders and leftover images (`octopod prune`), never its data; it asks for a second click
too. *Destroy…* removes the project's data for good (`octopod destroy`): it lists what goes
and how much, and acts only once the project's name is typed. A project octopod cannot read
(its folder gone, its `octopod.yaml` broken) shows its error and *Unregister* instead, two
clicks (`octopod unregister`): octopod forgets it, its folder and data stay. The rest (`restart`, `exec`,
`run`, removing volumes) stays on the command line. It links to Traefik's dashboard at
`http://traefik.octopod.localhost`.

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
