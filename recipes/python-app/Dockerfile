# syntax=docker/dockerfile:1
# supervisord running the project's programs as the project's user at the operator's uid.
# The system packages and uv make the environment; the project's dependencies (uv sync)
# stay the project's, installed in the running app into its .venv.
ARG BASE_IMAGE
FROM ghcr.io/astral-sh/uv:0.9 AS uv
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
ARG WORKSPACE=/app
ARG DRIVERS=""

COPY --from=uv /uv /uvx /usr/local/bin/
# supervisord runs the programs; git is what uv needs for a git dependency. A driver's
# build needs (a compiler, its client's headers) only when the project names it.
RUN set -e; packages="supervisor git"; \
 for driver in $DRIVERS; do case "$driver" in \
   mysql) packages="$packages gcc libc6-dev pkg-config libmariadb-dev" ;; \
   *) echo "unknown driver: $driver" >&2; exit 1 ;; \
 esac; done; \
 apt-get update \
 && apt-get install -y --no-install-recommends $packages \
 && rm -rf /var/lib/apt/lists/*

# The image has no user of its own: one named after the project, at the operator's uid/gid.
RUN groupadd -o -g "$GID" "$USER_NAME" \
 && useradd -o -m -u "$UID" -g "$GID" -d "/home/$USER_NAME" -s /bin/bash "$USER_NAME"

# The project's .venv first: its uvicorn, its python, its tools.
ENV PATH="${WORKSPACE}/.venv/bin:${PATH}"

COPY <<'EOF' /etc/octopod/supervisord.conf
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
pidfile=/tmp/supervisord.pid

[unix_http_server]
file=/tmp/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///tmp/supervisor.sock

; The project's programs: programs: in octopod.yaml, rendered by octopod, and the files of
; its supervisor_d folder. Both mounted by octopod; either may be absent.
[include]
files = /etc/octopod/programs.conf /etc/octopod/supervisord.d/*.conf
EOF

# octopod's shell settings (prompt, history), mounted at /etc/octopod/bashrc when it runs.
RUN echo '[ -f /etc/octopod/bashrc ] && . /etc/octopod/bashrc' >> /etc/bash.bashrc

USER ${USER_NAME}
WORKDIR ${WORKSPACE}
