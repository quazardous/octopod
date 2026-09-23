# octopod on Windows

octopod runs on Windows 10 and 11 with Docker Desktop, from 0.3. The edge, the projects,
the recipes and the console work as on Linux; the tray takes the place of the systemd user
service. This page is what is particular to Windows: what to install, how, and the few
things that behave differently from Linux.

## What you need

- **Windows 10 22H2 or Windows 11**, with virtualization turned on in the firmware (Task
  Manager › Performance › CPU says *Virtualization: Enabled*).
- **WSL 2**, which Docker Desktop runs its Linux engine in. In an administrator PowerShell,
  then restart:

  ```powershell
  wsl --install --no-distribution
  ```

  `wsl --status` then says *Default Version: 2*. No Linux distribution of your own is
  needed: Docker Desktop brings its own (`docker-desktop`).
- **Docker Desktop**, with the WSL 2 based engine (its default) and **Linux containers**:
  if its tray menu offers *Switch to Linux containers…*, it is on Windows containers — switch.
  Check both:

  ```powershell
  docker info --format '{{.OSType}}'   # linux
  docker compose version              # Docker Compose version v2 or later
  ```

- **Node.js 22 or later** and, to install from a clone, **Git**:

  ```powershell
  winget install OpenJS.NodeJS.LTS
  winget install Git.Git
  ```

## Install

Docker Desktop must be running.

### From npm

```powershell
npm i -g @quazardous/octopod    # the scoped name: `octopod` alone on npm is another project
octopod setup                   # checks Docker, starts the edge
```

`octopod setup` says there is no systemd user session: on Windows the API is the tray's
(below). The tray comes with the package; start it with
`%APPDATA%\npm\node_modules\@quazardous\octopod\bin\octopod-tray.cmd`, and tick *Start with
Windows* in its menu to have it at every sign-in.

### From a clone, with the tray in the Start menu

```powershell
git clone https://github.com/quazardous/octopod
cd octopod
.\setup.ps1              # -NoEdge: without starting the edge; -NoTray: without the tray
```

It installs the dependencies, puts `octopod` on your PATH (`~\.local\bin`, for PowerShell,
cmd and Git Bash), starts the edge, adds *octopod* to the Start menu and starts the tray.
Run it again after a `git pull`: it replaces the running tray with the new one.

If PowerShell refuses to run the script (*running scripts is disabled on this system*),
allow your own scripts once, or run this one alone:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# or
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

If `~\.local\bin` is not on your PATH, `setup.ps1` prints the line that adds it; open a new
terminal after.

## The tray

The tako in the notification area is red while the edge runs, grey and asleep when it is
stopped or Docker Desktop is off. Its menu (right or left click):

- the projects, each with its URLs, *Start* (`octopod up`), *Stop* (`octopod down`) and its
  folder;
- *octopod console* and *Traefik dashboard*, *Start/Stop the edge*, *Start Docker Desktop*
  when Docker is off;
- *Start with Windows* — a value in `HKCU\…\Run`, which *Settings › Apps › Startup* shows and
  can turn off;
- *Quit* — the edge keeps running: it is Docker's, and comes back with Docker Desktop.

The tray also runs octopod's API, which the console reads: Windows has no unix sockets, so
there `octopod serve` listens on `127.0.0.1` with a token (see
[SECURITY.md](../SECURITY.md)). The tray starts it, and starts it again if it ends. Without
the tray, run `octopod serve` in a terminal for the console.

## Docker Desktop settings worth a look

- **Start Docker Desktop when you sign in** (Settings › General): the edge and the projects'
  containers come back with it (`restart: unless-stopped`).
- **Memory**: the WSL 2 engine takes its memory from WSL, not from Docker Desktop's
  settings. To bound it, in `%USERPROFILE%\.wslconfig`, then `wsl --shutdown` and start
  Docker Desktop again:

  ```ini
  [wsl2]
  memory=8GB
  ```

- **File sharing** needs nothing with the WSL 2 engine: any folder of a Windows drive can be
  a project.

## What is different from Linux

**A file changed on Windows raises no event in the container.** An editor's save, a
`git checkout`, a tool writing in the project from Windows: the file changes in the
container, but a dev server watching for changes (Vite, webpack, nodemon, `tsx watch`…) is
not told, and does not reload. (Tested with Docker Desktop and its WSL 2 engine: a write
made inside the container is seen, the same write made from Windows is not.) The watcher
has to poll instead. The `node-app` recipe does it for you on Windows: it sets
`CHOKIDAR_USEPOLLING` (the tools built on chokidar, Vite's among them) and
`WATCHPACK_POLLING` (webpack, Next.js). A tool that polls only through its own
configuration still needs it there: Vite's `server.watch.usePolling: true`, nodemon's
`-L`. In a project with its own compose file, set the two variables on its service. The edge has the same limit, and octopod works around it itself: it restarts Traefik
when its own middleware file changes.

**`*.localhost` resolves in browsers and `curl`, not in the rest of Windows.** Chrome, Edge,
Firefox and `curl.exe` send `*.localhost` to your machine on their own; Windows' resolver
does not, so Node, `Invoke-WebRequest` and most other programs say the host is unknown.
Give them the edge's address and the name in a header:

```powershell
curl.exe http://whoami.localhost/                                      # fine
Invoke-WebRequest http://127.0.0.1/ -Headers @{ Host = 'whoami.localhost' }
```

or add the names you need to `C:\Windows\System32\drivers\etc\hosts` (as administrator; it
takes no wildcard): `127.0.0.1 whoami.localhost`.

**Line endings.** Git for Windows checks text files out with CRLF (`core.autocrlf=true`, its
default). Scripts and configuration files that end up in a Linux container break on the
carriage return: `/bin/sh^M: bad interpreter`, a config line nginx does not understand. In
your projects, a `.gitattributes` keeps them in LF whatever the setting:

```gitattributes
* text=auto eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
```

octopod's own repository has one; `git add --renormalize .` applies it to a clone made
before.

**Port 80.** The edge takes port 80 when it is free, 8480 otherwise, and keeps its choice;
`octopod edge status` gives the URLs. On Windows, IIS (*World Wide Web Publishing Service*)
is the usual holder of port 80; `netstat -ano | findstr ":80 "` and the process id in Task
Manager tell which program has it.

**Speed.** A project's folder on a Windows drive reaches the Linux containers through a
file-sharing layer: fine for the sources, slower for tens of thousands of small files
(`node_modules`, a `vendor/` folder) than on Linux.

**Ownership warnings** (a service writing in the project as root, data files owned by
another uid) are read from Linux uids and `/proc`: there are none on Windows, so octopod
does not give them there.

## Where things are

| What | Where |
|---|---|
| The command (clone) | `~\.local\bin\octopod.cmd`, and `octopod` for Git Bash |
| State: projects, the edge's files | `%USERPROFILE%\.local\state\octopod` (`OCTOPOD_STATE_DIR` moves it) |
| The API's port and token | `api.json` in the state folder |
| The API's logs, when the tray runs it | `serve.log` and `serve.err.log` in the state folder |
| The Start menu shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\octopod.lnk` |
| *Start with Windows* | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `octopod-tray` |

## When something does not work

| What you see | What to do |
|---|---|
| `octopod setup`: *Docker is not installed, or its daemon does not answer* | Start Docker Desktop and wait for *Engine running*; `docker info` must answer. |
| `octopod setup`: *Docker Compose v2 (docker compose) is missing* | `docker compose version` in the same terminal: if it answers, update octopod (0.3 fixed this on Windows). |
| `docker info` answers `OSType: windows` | Docker Desktop is on Windows containers: *Switch to Linux containers…* in its tray menu. |
| Docker Desktop: *WSL 2 is not installed* or *Virtual Machine Platform* | `wsl --install --no-distribution` as administrator, restart; turn virtualization on in the firmware. |
| The tray is grey, *Docker does not answer* | Docker Desktop is off or starting: *Start Docker Desktop* in the tray's menu. |
| The console says *octopod is not serving* | Start the tray, or `octopod serve` in a terminal; the API's errors are in `serve.err.log`. |
| An app does not reload after an edit | See *A file changed on Windows raises no event*, above: have its watcher poll. |
| `/bin/sh^M` or `$'\r': command not found` in a container | CRLF line endings: see *Line endings*, above. |
| Two taki in the notification area | A tray that was killed leaves its icon until the mouse passes over it; `setup.ps1` asks the running tray to quit instead. |
| `.\setup.ps1` is refused | See the execution policy, under *From a clone*. |

## Uninstall

```powershell
octopod edge down
octopod list                       # then octopod down <project> for each
```

Quit the tray (its menu), untick *Start with Windows* first if you ticked it; delete the
Start menu shortcut, `~\.local\bin\octopod.cmd` and `~\.local\bin\octopod`, and the state
folder. Installed from npm: `npm rm -g @quazardous/octopod`. The projects' own
`.octopod/` folders hold their data: delete them if you do not keep it.
