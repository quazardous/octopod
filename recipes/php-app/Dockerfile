# syntax=docker/dockerfile:1
# PHP-FPM and nginx in one container, run by supervisord as the project's user at the
# operator's uid. The system packages and the PHP extensions make the environment; the
# project's dependencies (composer install) stay the project's, installed in the running app.
ARG BASE_IMAGE
FROM mlocati/php-extension-installer:2 AS extensions
FROM composer:2 AS composer
FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
ARG EXTENSIONS="intl opcache zip"
ARG DOCROOT=public

COPY --from=extensions /usr/bin/install-php-extensions /usr/local/bin/
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
# nginx and supervisord run the app; unzip and git are what composer needs to work.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx supervisor unzip git \
 && rm -rf /var/lib/apt/lists/* \
 && install-php-extensions ${EXTENSIONS}

# The image's www-data, renamed after the project and moved to the operator's uid/gid:
# what the app writes in the project is the operator's, and no chown runs at start.
RUN groupmod -o -g "$GID" -n "$USER_NAME" www-data \
 && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m www-data

# Everything runs as that user: nginx on 8080, its files and pids in /tmp (a tmpfs).
COPY <<'EOF' /etc/octopod/nginx.conf
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 256; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /dev/stdout;
  client_body_temp_path /tmp/nginx-client;
  proxy_temp_path /tmp/nginx-proxy;
  fastcgi_temp_path /tmp/nginx-fastcgi;
  uwsgi_temp_path /tmp/nginx-uwsgi;
  scgi_temp_path /tmp/nginx-scgi;
  client_max_body_size 64m;
  server {
    listen 8080;
    root /app/__DOCROOT__;
    index index.php index.html;
    location / { try_files $uri $uri/ /index.php$is_args$args; }
    location ~ \.php$ {
      include /etc/nginx/fastcgi_params;
      fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
      fastcgi_pass 127.0.0.1:9000;
    }
  }
}
EOF
RUN sed -i "s#__DOCROOT__#${DOCROOT}#" /etc/octopod/nginx.conf

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

[program:php-fpm]
command=php-fpm --nodaemonize
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
autorestart=true

[program:nginx]
command=nginx -e /dev/stderr -c /etc/octopod/nginx.conf -g "daemon off;"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
autorestart=true
EOF

USER ${USER_NAME}
WORKDIR /app
