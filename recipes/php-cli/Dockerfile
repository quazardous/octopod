# PHP on the command line, run as the project's user at the operator's uid. The extensions
# and composer make the environment; the tools stay the project's (composer require --dev).
ARG BASE_IMAGE
FROM mlocati/php-extension-installer:2 AS extensions
FROM composer:2 AS composer
FROM ${BASE_IMAGE}
# Each ARG just before its first use: a RUN after an ARG is built again when its value
# changes. The heavy layer depends on the PHP image and its extensions only, shared by the
# projects that ask for the same; the project's own come last.
ARG EXTENSIONS="intl zip"

COPY --from=extensions /usr/bin/install-php-extensions /usr/local/bin/
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
# unzip and git are what composer needs to work. octopod's shell settings (prompt,
# history) are mounted at /etc/octopod/bashrc when it runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip git \
 && rm -rf /var/lib/apt/lists/* \
 && install-php-extensions ${EXTENSIONS} \
 && echo '[ -f /etc/octopod/bashrc ] && . /etc/octopod/bashrc' >> /etc/bash.bashrc

ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
# The image's www-data, renamed after the project and moved to the operator's uid/gid.
RUN groupmod -o -g "$GID" -n "$USER_NAME" www-data \
 && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m www-data

ARG WORKSPACE=/app
USER ${USER_NAME}
WORKDIR ${WORKSPACE}
