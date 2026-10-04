#!/usr/bin/env bash
# Writes TLS material from env, starts RabbitMQ, then reconciles the vhost,
# users and permissions so passwords in Secrets Manager stay authoritative.
set -euo pipefail

: "${RABBITMQ_TLS_CA:?RABBITMQ_TLS_CA is required}"
: "${RABBITMQ_TLS_CERT:?RABBITMQ_TLS_CERT is required}"
: "${RABBITMQ_TLS_KEY:?RABBITMQ_TLS_KEY is required}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
: "${TRACKER_PASSWORD:?TRACKER_PASSWORD is required}"
: "${WORKER_PASSWORD:?WORKER_PASSWORD is required}"
VHOST="${POC_VHOST:-app_usage}"

mkdir -p /etc/rabbitmq/tls
printf '%s\n' "$RABBITMQ_TLS_CA" > /etc/rabbitmq/tls/ca.pem
printf '%s\n' "$RABBITMQ_TLS_CERT" > /etc/rabbitmq/tls/cert.pem
printf '%s\n' "$RABBITMQ_TLS_KEY" > /etc/rabbitmq/tls/key.pem
chown -R rabbitmq:rabbitmq /etc/rabbitmq/tls
chmod 0600 /etc/rabbitmq/tls/key.pem

docker-entrypoint.sh rabbitmq-server &
server_pid=$!
trap 'kill -TERM "$server_pid" 2>/dev/null; wait "$server_pid"' TERM INT

ctl() { gosu rabbitmq rabbitmqctl --quiet "$@"; }

# await_startup fails if the node has not registered yet, so retry until it has.
for _ in $(seq 1 90); do
  if gosu rabbitmq rabbitmqctl --quiet await_startup --timeout 10 >/dev/null 2>&1; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo "poc-entrypoint: rabbitmq-server exited" >&2; exit 1; }
  sleep 2
done
gosu rabbitmq rabbitmqctl --quiet await_startup --timeout 30

# Pre-declare the vhost and telemetry exchange (same arguments the Tracker and
# worker declare) so topic permissions can reference the exchange.
cat > /tmp/poc-definitions.json <<EOF
{"vhosts":[{"name":"$VHOST"}],
 "exchanges":[{"name":"tracker.telemetry","vhost":"$VHOST","type":"topic","durable":true,
               "auto_delete":false,"internal":false,"arguments":{}}]}
EOF
chown rabbitmq /tmp/poc-definitions.json
ctl import_definitions /tmp/poc-definitions.json

ensure_user() {
  local user="$1" password="$2" tags="$3"
  if ctl list_users --no-table-headers | cut -f1 | grep -qx "$user"; then
    ctl change_password "$user" "$password"
  else
    ctl add_user "$user" "$password"
  fi
  ctl set_user_tags "$user" $tags
}

ensure_user admin "$ADMIN_PASSWORD" administrator
ensure_user tracker "$TRACKER_PASSWORD" ""
ensure_user worker "$WORKER_PASSWORD" ""
ctl delete_user guest 2>/dev/null || true

ctl set_permissions -p "$VHOST" admin '.*' '.*' '.*'
# Tracker: declare and publish to the telemetry exchange only, read nothing,
# and only with its own telemetry.* routing keys.
ctl set_permissions -p "$VHOST" tracker '^tracker\.telemetry$' '^tracker\.telemetry$' '^$'
ctl set_topic_permissions -p "$VHOST" tracker tracker.telemetry '^telemetry\.' '^$'
# Worker: the exchange, its dead-letter exchange and the persist queue + DLQ.
worker_names='^(tracker\.telemetry|tracker\.telemetry\.dlx|portal\.telemetry\.persist|portal\.telemetry\.persist\.dlq)$'
ctl set_permissions -p "$VHOST" worker "$worker_names" "$worker_names" "$worker_names"

echo "poc-entrypoint: vhost '$VHOST' and users reconciled"
wait "$server_pid"
