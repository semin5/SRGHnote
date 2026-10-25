#!/bin/sh
set -eu

live=/home/semin5/SRGHIT-ha/nginx-ha.conf
candidate=/tmp/nginx-ha-notion-new-20261011.conf
backup=/home/semin5/SRGHIT-ha/nginx-ha.conf.before-notion-20261011

if [ ! -f "$backup" ]; then cp -p "$live" "$backup"; fi
cp "$candidate" "$live"
# The configuration is a read-only single-file bind mount. Reload keeps the old inode;
# restarting the container rebinds the current host file.
if ! docker restart SRGH_IT-nginx >/dev/null || ! docker exec SRGH_IT-nginx nginx -t; then
  cp "$backup" "$live"
  docker restart SRGH_IT-nginx >/dev/null || true
  exit 1
fi
if ! curl -fsS --max-time 5 -o /dev/null -H 'Host: sarangmc.kr' http://127.0.0.1/notion/; then
  cp "$backup" "$live"
  docker restart SRGH_IT-nginx >/dev/null || true
  exit 1
fi
