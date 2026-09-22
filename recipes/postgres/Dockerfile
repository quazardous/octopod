# The image's `postgres` user moved to the operator's uid/gid (not renamed: the image's
# scripts know it by name). The entrypoint still starts as root and drops to it, so the
# data it writes in the project is the operator's. Nothing is installed.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
RUN groupmod -o -g "$GID" postgres \
 && usermod -o -u "$UID" -g "$GID" postgres \
 && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql
