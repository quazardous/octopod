# Mailpit as the operator's uid/gid rather than root: it needs no privilege, and keeps its
# mails in /tmp.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
USER ${UID}:${GID}
