# mongo-express as the operator's uid/gid rather than root: it needs no privilege.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
USER ${UID}:${GID}
