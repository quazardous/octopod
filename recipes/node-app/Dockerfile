# The image's `node` user, renamed after the project and moved to the operator's uid/gid
# at build time: the files the app writes in the project are the operator's, and no chown
# runs at start. Nothing is installed: dependencies belong to the project.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
# -o: the operator's ids may already be taken in the image (1000 is node's own).
RUN groupmod -o -g "$GID" -n "$USER_NAME" node \
 && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m node
USER ${USER_NAME}
WORKDIR /app
