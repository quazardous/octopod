# The image's `mysql` user moved to the operator's uid/gid, not renamed: the data it
# writes in the project is the operator's. Nothing is installed.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
RUN groupmod -o -g "$GID" mysql \
 && usermod -o -u "$UID" -g "$GID" mysql
