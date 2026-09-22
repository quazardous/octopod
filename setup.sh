#!/usr/bin/env bash
# Sets octopod up from a clone: dependencies, the `octopod` command on your PATH, the API
# as a user service (what the console reads), and the shared edge started. Safe to run
# again (after a pull, for instance). Needs no root.
#
#   ./setup.sh                 # links the command into ~/.local/bin
#   ./setup.sh --no-edge       # … without starting the edge
#   ./setup.sh --no-service    # … without the user service (run `octopod serve` yourself)
#   BIN_DIR=~/bin ./setup.sh   # … or elsewhere
#
# The command is a link to bin/octopod, which runs the sources: a change to the code needs
# no new setup. Run it again after a dependency change.
set -euo pipefail

EDGE=1
SERVICE=1
for arg in "$@"; do
  case "$arg" in
    --no-edge) EDGE=0 ;;
    --no-service) SERVICE=0 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

say "Checking requirements"
command -v node >/dev/null || fail "Node.js is not installed (22 or later is needed)"
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || fail "Node.js $(node -v) is too old: 22 or later is needed"
command -v npm >/dev/null || fail "npm is not installed"
command -v docker >/dev/null || fail "Docker is not installed"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 (docker compose) is missing"
docker info >/dev/null 2>&1 || fail "Docker does not answer: is the daemon running, and may your user use it?"
echo "  node $(node -v), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"

say "Installing dependencies"
(cd "$ROOT" && npm install --no-fund --no-audit)

say "Linking the octopod command"
mkdir -p "$BIN_DIR"
target="$BIN_DIR/octopod"
if [ -e "$target" ] && [ "$(readlink -f "$target")" != "$ROOT/bin/octopod" ]; then
  fail "$target exists and is not this octopod; move it away, or run with BIN_DIR=<another folder>"
fi
ln -sfn "$ROOT/bin/octopod" "$target"
echo "  $target → $ROOT/bin/octopod"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH: add  export PATH=\"$BIN_DIR:\$PATH\"  to your shell's profile" ;;
esac

if [ "$SERVICE" = 1 ]; then
  say "Serving the API (for the console and other tools)"
  if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$unit_dir"
    # The PATH of this shell: the service runs docker, and needs to find it as you do.
    cat >"$unit_dir/octopod.service" <<UNIT
[Unit]
Description=octopod — the API and the console's data

[Service]
ExecStart=$ROOT/bin/octopod serve
Environment=PATH=$PATH
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable octopod.service >/dev/null
    systemctl --user restart octopod.service
    echo "  octopod.service enabled and started (systemctl --user status octopod)"
  else
    warn "no systemd user session: run  octopod serve  yourself for the console"
  fi
fi

if [ "$EDGE" = 1 ]; then
  say "Starting the edge"
  "$ROOT/bin/octopod" edge up
fi

cat <<EOF

$(say "Done. Next, in a project folder:")
  octopod.yaml   services: { app: { recipe: node-app } }   (or expose: for your own compose file)
  octopod register && octopod up
  octopod recipes   the recipes a project can name
  octopod edge status   the console (http://octopod.localhost): every project, its services and logs

  More: $ROOT/README.md
EOF
