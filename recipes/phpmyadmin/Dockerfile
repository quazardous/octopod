# Apache as www-data on 8080 rather than root on 80: it needs no privilege then. The port is
# set here, as root: the entrypoint's APACHE_PORT rewrites Apache's files at start, which
# www-data cannot. What the entrypoint still writes (its secret, the sessions, the PHP limits)
# is www-data's.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
 && sed -i 's/<VirtualHost \*:80>/<VirtualHost *:8080>/' /etc/apache2/sites-available/000-default.conf \
 && grep -q '^Listen 8080$' /etc/apache2/ports.conf \
 && mkdir -p /sessions \
 && chown -R www-data:www-data /etc/phpmyadmin /sessions /usr/local/etc/php/conf.d
USER www-data
