#!/bin/sh
# Drop privileges before starting the app. Older deployments have a /data volume
# owned by root, so when started as root fix its ownership first, then switch to
# the unprivileged user. When started as a non-root user (e.g. --user), just run.
set -e

if [ "$(id -u)" = "0" ]; then
    chown -R garage:garage /data
    exec su-exec garage:garage /usr/local/bin/garage-admin "$@"
fi

exec /usr/local/bin/garage-admin "$@"
