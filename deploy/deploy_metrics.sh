#!/bin/sh
set -eu

candidate=$1
live=/opt/srgh-monitoring/srgh_metrics.py
backup=/opt/srgh-monitoring/srgh_metrics.py.before-notion-20261011

cp -p "$live" "$backup"
install -m 755 "$candidate" "$live"
systemctl restart srgh-metrics.service
sleep 2
if ! systemctl is-active --quiet srgh-metrics.service ||
   ! curl -fsS --max-time 5 http://127.0.0.1:9198/metrics | grep -q 'srgh_vip_port_up.*port="3019"'; then
  cp -p "$backup" "$live"
  systemctl restart srgh-metrics.service
  exit 1
fi
