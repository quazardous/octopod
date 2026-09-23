# Apache as www-data on 8080 rather than root on 80: it needs no privilege then. What the
# entrypoint writes (its secret, the sessions) is made www-data's.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN chown -R www-data:www-data /etc/phpmyadmin /sessions /var/www/html 2>/dev/null || true
USER www-data
