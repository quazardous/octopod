# The image's `valkey` user moved to the operator's uid/gid: what it keeps in the project is
# the operator's. Nothing is installed.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
RUN groupmod -o -g "$GID" valkey \
 && usermod -o -u "$UID" -g "$GID" valkey
