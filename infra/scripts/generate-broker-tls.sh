#!/usr/bin/env bash
# Creates the POC broker's private CA and server certificate.
#
#   infra/scripts/generate-broker-tls.sh            # generate only
#   infra/scripts/generate-broker-tls.sh --upload   # also store in Secrets Manager
#
# Outputs (outside the repo, in ~/.usage-poc/broker-tls):
#   ca.pem      CA certificate - distribute to Tracker laptops (RABBITMQ_CA_FILE)
#   ca.key      CA private key - keep private; only needed to re-issue the server cert
#   server.pem / server.key  broker certificate for $SERVER_NAME
# With --upload, ca/cert/key go to the Secrets Manager secret $SECRET_NAME and
# its ARN is printed for cdk.json (context key brokerTlsSecretArn).
set -euo pipefail

SERVER_NAME="${SERVER_NAME:-mq.usage-poc.internal}"
SECRET_NAME="${SECRET_NAME:-usage-poc/rabbitmq-tls}"
REGION="${AWS_REGION:-us-east-1}"
OUT="${OUT_DIR:-$HOME/.usage-poc/broker-tls}"
export MSYS_NO_PATHCONV=1  # Git Bash: keep "/CN=..." subjects intact

mkdir -p "$OUT"
cd "$OUT"

if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
    -keyout ca.key -out ca.pem -subj "/CN=usage-poc broker CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "Created CA in $OUT"
fi

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$SERVER_NAME"
cat > server.ext <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$SERVER_NAME
EOF
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -days 825 -out server.pem -extfile server.ext
rm -f server.csr server.ext
chmod 600 ca.key server.key 2>/dev/null || true
openssl verify -CAfile ca.pem server.pem

if [ "${1:-}" = "--upload" ]; then
  payload="$(node -e '
    const fs = require("fs");
    process.stdout.write(JSON.stringify({
      ca: fs.readFileSync("ca.pem", "utf8"),
      cert: fs.readFileSync("server.pem", "utf8"),
      key: fs.readFileSync("server.key", "utf8"),
    }));')"
  if aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET_NAME" \
      --secret-string "$payload" >/dev/null
  else
    aws secretsmanager create-secret --region "$REGION" --name "$SECRET_NAME" \
      --description "usage-poc RabbitMQ TLS (private CA)" \
      --tags Key=project,Value=usage-poc --secret-string "$payload" >/dev/null
  fi
  echo "brokerTlsSecretArn=$(aws secretsmanager describe-secret --region "$REGION" \
    --secret-id "$SECRET_NAME" --query ARN --output text)"
fi
