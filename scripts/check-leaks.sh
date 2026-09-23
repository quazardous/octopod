#!/usr/bin/env bash
# Looks for what must not reach a public repository: absolute home paths of a real
# machine, references to a private issue tracker, and obvious secrets. Prints each hit as
# file:line: kind: text and exits 1 when there is any.
#
#   scripts/check-leaks.sh             # the tracked files, as they are in the working tree
#   scripts/check-leaks.sh --staged    # the staged content (the pre-commit hook)
#   scripts/check-leaks.sh --history   # every commit message and every line ever added
#
# What it looks for:
#   - /home/<name> and /Users/<name>, except the fixture names in ALLOWED_HOMES. A path
#     built from a variable (/home/$USER_NAME) is not a name, and is not reported;
#   - `#` followed by 3 digits or more (a ticket of a private tracker) in markdown and
#     text files, in comments of code files, and in commit messages;
#   - a few secrets that cannot be mistaken (private keys, cloud and forge tokens). When
#     gitleaks is on the PATH, it runs too; otherwise the script says it skipped it.
#
# package-lock.json is left out: it holds registry URLs and hashes, nothing of ours.
set -euo pipefail

MODE=tree
case "${1:-}" in
  '') ;;
  --staged) MODE=staged ;;
  --history) MODE=history ;;
  -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)"

# Home folder names that are fixtures, not someone's machine. Keep this list minimal.
ALLOWED_HOMES='op delta shop shop-2 app 2'

# A cheap first pass for git grep; the awk below decides what is a hit.
PREFILTER='/home/|/Users/|#[0-9]{3}|PRIVATE KEY|AKIA|gh[pousr]_|github_pat_|xox[abprs]-|sk-'

# Reads records "location<TAB>path<TAB>text" (path is "message" for a commit message) and
# prints the hits. Every mode feeds it, so the rules are the same everywhere.
judge() {
  awk -F '\t' -v allowed="$ALLOWED_HOMES" '
    BEGIN {
      n = split(allowed, list, " ")
      for (i = 1; i <= n; i++) ok[list[i]] = 1
    }
    function report(what) { printf "%s: %s: %s\n", $1, what, text; hits++ }
    function home_leak(s,   rest, name) {
      rest = s
      while (match(rest, /\/(home|Users)\/[A-Za-z0-9._-]+/)) {
        name = substr(rest, RSTART, RLENGTH)
        sub(/^\/(home|Users)\//, "", name)
        if (!(name in ok)) return 1
        rest = substr(rest, RSTART + RLENGTH)
      }
      return 0
    }
    # Where a ticket number would be prose: the whole of a markdown or text file, a commit
    # message, or the comment part of a line of code.
    function prose(path, s,   base) {
      if (path == "message" || path ~ /\.(md|markdown|txt)$/) return s
      base = path; sub(/.*\//, "", base)
      if (path ~ /\.(ts|tsx|js|mjs|cjs|css|scss)$/) {
        if (match(s, /\/\/|\/\*/)) return substr(s, RSTART)
        if (s ~ /^[ \t]*\*/) return s
        return ""
      }
      if (path ~ /\.(sh|bash|ya?ml|toml)$/ || base == "Dockerfile" || base ~ /^\.git/ || path ~ /^(bin|\.githooks)\//) {
        # A comment starts with a # at the start of the line or after a blank.
        if (match(s, /(^|[ \t])#/)) return substr(s, RSTART)
        return ""
      }
      if (path ~ /\.html?$/) {
        if (match(s, /<!--/)) return substr(s, RSTART)
        return ""
      }
      return ""
    }
    # A secret shape: its prefix, then enough of its alphabet (no {n}: not every awk has it).
    function shaped(s, re, min) { return match(s, re) && RLENGTH >= min }
    {
      path = $2
      text = substr($0, length($1) + length($2) + 3)
      if (path ~ /(^|\/)package-lock\.json$/) next
      if (home_leak(text)) report("home path")
      if (prose(path, text) ~ /(^|[^&A-Za-z0-9_\/])#[0-9][0-9][0-9]+/) report("ticket reference")
      if (text ~ /-----BEGIN[ A-Z]*PRIVATE KEY-----/ ||
          shaped(text, "AKIA[0-9A-Z]+", 20) ||
          shaped(text, "gh[pousr]_[A-Za-z0-9]+", 40) ||
          shaped(text, "github_pat_[A-Za-z0-9_]+", 40) ||
          shaped(text, "xox[abprs]-[A-Za-z0-9-]+", 15) ||
          shaped(text, "(^|[^A-Za-z0-9])sk-(ant-)?[A-Za-z0-9_-]+", 24)) report("secret")
    }
    END { exit hits > 0 }
  '
}

# git grep prints path:line:text; the paths of this repository have no colon.
from_grep() {
  sed -E 's/^([^:]*):([0-9]+):/\1:\2\t\1\t/'
}

# Every added line of every commit, with its commit, path and line number, then every
# line of every commit message. A blob's whole content was added by some commit, so this
# sees everything the history holds.
from_history() {
  git log --all -p --no-color --no-ext-diff --format='commit %H' | awk '
    /^commit [0-9a-f]+$/ { sha = substr($2, 1, 10); path = ""; next }
    /^diff --git / { header = 1; path = ""; next }
    header && /^\+\+\+ / { path = substr($0, 5); sub(/^b\//, "", path); next }
    /^@@ / { header = 0; split($3, a, ","); line = substr(a[1], 2) + 0; next }
    header || path == "" || path == "/dev/null" { next }
    /^\+/ { printf "commit %s %s:%d\t%s\t%s\n", sha, path, line, path, substr($0, 2); line++; next }
    /^ / { line++ }
  '
  git log --all --format='@@check-leaks %h%n%B' | awk '
    /^@@check-leaks / { sha = $2; line = 0; next }
    { line++; printf "commit %s message:%d\tmessage\t%s\n", sha, line, $0 }
  '
}

status=0
case "$MODE" in
  tree)    git grep -nIE "$PREFILTER" -- . ':(exclude)package-lock.json' | from_grep | judge || status=1 ;;
  staged)  git grep --cached -nIE "$PREFILTER" -- . ':(exclude)package-lock.json' | from_grep | judge || status=1 ;;
  history) from_history | judge || status=1 ;;
esac

if command -v gitleaks >/dev/null; then
  if [ "$MODE" = staged ]; then
    gitleaks protect --staged --no-banner || status=1
  else
    gitleaks detect --no-banner || status=1
  fi
else
  echo "check-leaks: gitleaks is not installed; its secret scan was skipped" >&2
fi

if [ "$status" -ne 0 ]; then
  echo "check-leaks: hits above; fix them (or, for a fixture, see ALLOWED_HOMES)" >&2
fi
exit "$status"
