#!/usr/bin/env bash
# Does octopod's GNOME Shell extension load on this machine's GNOME Shell?
#
# metadata.json lists the shell versions the extension runs on, and a major release can
# break it silently: it just stops appearing. So checking is one command, run before a
# release: a headless, throwaway GNOME Shell (its own dconf and data folder — your session
# and its extensions are left alone), the extension installed as `octopod setup` does, then
# the shell's own answer:
#
#   ACTIVE  it loaded, and enable() ran without throwing
#   ERROR   it did not: the shell's log has the exception, printed below
#
# It does not check what the indicator looks like: headless has no screen.
#
# Usage: scripts/probe-gnome-extension.sh
set -uo pipefail

UUID="octopod@quazardous.github.io"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for cmd in gnome-shell gnome-extensions dbus-run-session gsettings node; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd"; exit 2; }
done

echo "shell   : $(gnome-shell --version)"
echo "declares: $(node -p "require('$REPO/gnome/$UUID/metadata.json')['shell-version'].join(', ')")"

# Short paths: a Wayland socket path is capped at 108 bytes, and a longer one fails to bind.
NEST="$(mktemp -d /tmp/op-probe-XXXXXX)"
trap 'rm -rf "$NEST"' EXIT
mkdir -p "$NEST/data/gnome-shell/extensions" "$NEST/config" "$NEST/run"
chmod 700 "$NEST/run"

export XDG_CONFIG_HOME="$NEST/config" XDG_DATA_HOME="$NEST/data" XDG_DATA_DIRS="/usr/local/share:/usr/share" XDG_RUNTIME_DIR="$NEST/run"
unset WAYLAND_DISPLAY DISPLAY

# Installed as setup does: the icons and config.json beside the code.
node --input-type=module -e "
  const { register } = await import('tsx/esm/api'); register();
  const { installGnomeExtension } = await import('$REPO/src/gnome.ts');
  await installGnomeExtension({ argv: ['octopod'], path: process.env.PATH, target: '$NEST/data/gnome-shell/extensions', run: async () => undefined });
" || { echo "install failed"; exit 2; }

dbus-run-session -- bash -c '
  set -u
  gsettings set org.gnome.shell disable-user-extensions false
  gnome-shell --headless --wayland --wayland-display=op-probe > "'"$NEST"'/shell.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 30); do
    sleep 1
    gnome-extensions info '"$UUID"' >/dev/null 2>&1 && break
  done
  gnome-extensions enable '"$UUID"' >/dev/null 2>&1
  sleep 4
  gnome-extensions info '"$UUID"' 2>/dev/null | grep -aE "State|État" | tail -1
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
' 2>/dev/null | tee "$NEST/state.txt"

if grep -qa "ACTIVE" "$NEST/state.txt"; then
  echo "verdict : loads and enables cleanly"
  exit 0
fi
echo "verdict : DID NOT LOAD — the shell said:"
grep -a -iE "octopod|JS ERROR" "$NEST/shell.log" | head -20
exit 1
