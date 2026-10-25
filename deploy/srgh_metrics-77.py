#!/usr/bin/env python3
"""Dependency-free metrics endpoint for SRGH_IT monitoring."""
import http.server
import os
import re
import socket
import subprocess

NODE = os.environ.get("SRGH_NODE", "unknown")
VIP = "192.168.1.76"
WITNESS = "192.168.1.249"
HOST_TARGETS = ("192.168.1.77", "192.168.1.78", "192.168.1.249")
DATABASES = (("mysql", 3307, "SRGH_IT-mysql-3307"),
             ("mysql", 3308, "mysql-ph"),
             ("mariadb", 3306, "SRGH_IT-mariadb-3306"))
POSTGRESQL_SERVICES = ((5432, "patroni-srgh5432.service"),
                       (5433, "patroni.service"))
SYSTEMD_PORTS = {
    3000: ("SRGH_IT-work-frontend.service", "SRGH_IT-work-api.service"),
    3001: ("SRGH_IT-management-frontend.service", "SRGH_IT-management-api.service"),
    3002: ("SRGH_IT-rad-frontend.service", "SRGH_IT-rad-api.service"),
    3003: ("SRGH_IT-qps-frontend.service", "SRGH_IT-qps-api.service"),
    3004: ("SRGH_IT-insa-frontend.service", "SRGH_IT-insa-api.service"),
    3005: ("SRGH_IT-history-frontend.service",),
    3006: ("SRGH_IT-accesslog.service",),
    3007: ("SRGH_IT-worklog.service",),
    3011: ("SRGH_IT-account.service",),
    3012: ("SRGH_IT-ip.service",),
    3013: ("SRGH_IT-nev.service",),
    3014: ("SRGH_IT-extension.service",),
    3016: ("SRGH_IT-server.service",),
    3017: ("SRGH_IT-vendor.service",),
    3018: ("SRGH_IT-rental.service",),
    3019: ("SRGH_IT-notion.service",),
}
DOCKER_PORTS = {
    3008: ("SRGH_IT-home",),
    3009: ("SRGH_IT-orchestrator",),
    3010: ("SRGH_IT-notice-frontend", "SRGH_IT-notice-backend"),
}
PREVIOUS_CPU = None

def run(*args, timeout=3):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

def cpu_percent():
    global PREVIOUS_CPU
    with open("/proc/stat", encoding="ascii") as stream:
        values = [int(value) for value in stream.readline().split()[1:]]
    total, idle = sum(values), values[3] + values[4]
    current = (total, idle)
    previous, PREVIOUS_CPU = PREVIOUS_CPU, current
    if previous is None or total == previous[0]:
        return 0.0
    return 100.0 * (1.0 - (idle - previous[1]) / (total - previous[0]))

def memory_values():
    values = {}
    with open("/proc/meminfo", encoding="ascii") as stream:
        for line in stream:
            key, value = line.split(":", 1)
            if key in ("MemTotal", "MemAvailable"):
                values[key] = int(value.split()[0])
    return values

def memory_available_percent():
    values = memory_values()
    return 100.0 * values["MemAvailable"] / values["MemTotal"]

def cgroup_memory_bytes(group):
    try:
        with open("/sys/fs/cgroup" + group + "/memory.current", encoding="ascii") as stream:
            return int(stream.read().strip())
    except (OSError, ValueError):
        return 0

def docker_memory_bytes():
    names = sorted({name for group in DOCKER_PORTS.values() for name in group}
                   | {container for _, _, container in DATABASES})
    try:
        result = run("docker", "inspect", "--format", "{{.Name}} {{.State.Pid}}", *names, timeout=4)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    memory = {}
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) != 2 or not parts[1].isdigit() or int(parts[1]) <= 0:
            continue
        try:
            with open(f"/proc/{parts[1]}/cgroup", encoding="ascii") as stream:
                group = next((entry.strip().split(":", 2)[2] for entry in stream
                              if entry.startswith("0::")), None)
            if group:
                memory[parts[0].lstrip("/")] = cgroup_memory_bytes(group)
        except OSError:
            continue
    return memory

def port_open(host, port):
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return 1
    except OSError:
        return 0

def witness_up():
    ping = run("ping", "-n", "-c", "1", "-W", "1", WITNESS, timeout=2)
    return int(ping.returncode == 0 or port_open(WITNESS, 22) == 1)

def host_reachable(host):
    """Check the host itself over ICMP, independently of application ports."""
    try:
        return int(run("ping", "-n", "-c", "1", "-W", "1", host, timeout=2).returncode == 0)
    except (OSError, subprocess.TimeoutExpired):
        return 0

def database_metrics(engine, port, container):
    inspect = run("docker", "inspect", "--format", "{{.State.Running}}", container)
    if inspect.returncode or inspect.stdout.strip() != "true":
        return None
    client = "mariadb" if engine == "mariadb" else "mysql"
    query = "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Max_used_connections'); SHOW GLOBAL VARIABLES LIKE 'max_connections'; SELECT 'read_only', @@global.read_only;"
    script = ('if [ -n "$MYSQL_ROOT_PASSWORD" ]; then MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; '
              'elif [ -n "$MARIADB_ROOT_PASSWORD" ]; then MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; '
              'elif [ -n "$MARIADB_ROOT_PASSWORD_FILE" ]; then MYSQL_PWD="$(cat "$MARIADB_ROOT_PASSWORD_FILE")"; '
              'fi; export MYSQL_PWD; exec ' + client + ' -uroot -N -e "$1"')
    result = run("docker", "exec", container, "sh", "-c", script, "srgh-metrics", query, timeout=5)
    if result.returncode:
        return None
    found = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 2 and re.fullmatch(r"\d+", parts[1]):
            found[parts[0].lower()] = int(parts[1])
    if "threads_connected" not in found or "max_connections" not in found:
        return None
    return found

def postgresql_metrics(port):
    query = ("SELECT current_setting('max_connections')::int, "
             "(SELECT count(*) FROM pg_stat_activity), "
             "CASE WHEN pg_is_in_recovery() THEN 0 ELSE 1 END")
    try:
        result = run("runuser", "-u", "postgres", "--", "psql", "-X", "-At",
                     "-p", str(port), "-d", "postgres", "-c", query,
                     timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    values = result.stdout.strip().split("|")
    if len(values) != 3 or not all(value.isdigit() for value in values):
        return None
    return dict(zip(("max_connections", "threads_connected", "primary"),
                    map(int, values)))

def collect():
    total_memory_bytes = memory_values()["MemTotal"] * 1024
    docker_memory = docker_memory_bytes()
    lines = ["# TYPE srgh_node_cpu_usage_percent gauge",
             f'srgh_node_cpu_usage_percent{{node="{NODE}"}} {cpu_percent():.2f}',
             "# TYPE srgh_node_memory_available_percent gauge",
             f'srgh_node_memory_available_percent{{node="{NODE}"}} {memory_available_percent():.2f}',
             "# TYPE srgh_vip_owner gauge"]
    addresses = run("ip", "-4", "addr", "show", timeout=2).stdout
    lines.append(f'srgh_vip_owner{{node="{NODE}"}} {int(VIP in addresses)}')
    lines.append("# TYPE srgh_peer_up gauge")
    lines.append(f'srgh_peer_up{{node="{NODE}",peer="1.249"}} {witness_up()}')
    lines.append("# TYPE srgh_host_reachable gauge")
    for host in HOST_TARGETS:
        lines.append(f'srgh_host_reachable{{node="{NODE}",target="{host}"}} {host_reachable(host)}')
    lines.append("# TYPE srgh_vip_port_up gauge")
    for port in range(3000, 3020):
        lines.append(f'srgh_vip_port_up{{node="{NODE}",port="{port}"}} {port_open(VIP, port)}')
    lines.append("# TYPE srgh_service_memory_usage_percent gauge")
    for port in range(3000, 3020):
        systemd_bytes = sum(cgroup_memory_bytes("/system.slice/" + unit)
                            for unit in SYSTEMD_PORTS.get(port, ()))
        container_bytes = sum(docker_memory.get(name, 0) for name in DOCKER_PORTS.get(port, ()))
        percent = 100.0 * (systemd_bytes + container_bytes) / total_memory_bytes
        lines.append(f'srgh_service_memory_usage_percent{{node="{NODE}",port="{port}"}} {percent:.3f}')
    lines.append("# TYPE srgh_db_process_memory_usage_percent gauge")
    for engine, port, container in DATABASES:
        percent = 100.0 * docker_memory.get(container, 0) / total_memory_bytes
        lines.append(f'srgh_db_process_memory_usage_percent{{node="{NODE}",engine="{engine}",port="{port}"}} {percent:.3f}')
    for pg_port, service in POSTGRESQL_SERVICES:
        pg_percent = 100.0 * cgroup_memory_bytes("/system.slice/" + service) / total_memory_bytes
        lines.append(f'srgh_db_process_memory_usage_percent{{node="{NODE}",engine="postgresql",port="{pg_port}"}} {pg_percent:.3f}')
    lines.extend(("# TYPE srgh_db_up gauge", "# TYPE srgh_db_primary gauge", "# TYPE srgh_db_connections gauge",
                  "# TYPE srgh_db_max_connections gauge", "# TYPE srgh_db_max_used_connections gauge"))
    for engine, port, container in DATABASES:
        label = f'node="{NODE}",engine="{engine}",port="{port}"'
        data = database_metrics(engine, port, container)
        lines.append(f"srgh_db_up{{{label}}} {int(data is not None)}")
        if data:
            if engine == "mysql" and "read_only" in data:
                lines.append(f"srgh_db_primary{{{label}}} {int(data['read_only'] == 0)}")
            lines.append(f"srgh_db_connections{{{label}}} {data['threads_connected']}")
            lines.append(f"srgh_db_max_connections{{{label}}} {data['max_connections']}")
            lines.append(f"srgh_db_max_used_connections{{{label}}} {data.get('max_used_connections', 0)}")
    for pg_port, _ in POSTGRESQL_SERVICES:
        pg_label = f'node="{NODE}",engine="postgresql",port="{pg_port}"'
        pg_data = postgresql_metrics(pg_port)
        lines.append(f"srgh_db_up{{{pg_label}}} {int(pg_data is not None)}")
        if pg_data:
            lines.append(f"srgh_db_primary{{{pg_label}}} {pg_data['primary']}")
            lines.append(f"srgh_db_connections{{{pg_label}}} {pg_data['threads_connected']}")
            lines.append(f"srgh_db_max_connections{{{pg_label}}} {pg_data['max_connections']}")
    return "\n".join(lines) + "\n"

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            self.send_error(404)
            return
        try:
            body = collect().encode()
        except Exception:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", 9198), Handler).serve_forever()
