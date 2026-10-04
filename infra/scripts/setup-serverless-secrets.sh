#!/usr/bin/env bash
# Creates the SecureString parameters the UsagePocServerless stack reads at
# Lambda cold start (CloudFormation cannot create SecureString parameters).
# Idempotent: existing values are never overwritten or printed.
#
#   bash infra/scripts/setup-serverless-secrets.sh
#
# Then set the real OpenAI key (from a file you delete afterwards):
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /usage-poc-sls/openai-api-key --value file://openai-key.txt
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash: keep /usage-poc-sls/... names intact

PREFIX="${PREFIX:-/usage-poc-sls}"
REGION="${AWS_REGION:-us-east-1}"

exists() {
  aws ssm get-parameter --region "$REGION" --name "$1" --query Parameter.Name --output text >/dev/null 2>&1
}

create() {
  local name="$1" value="$2" description="$3"
  if exists "$name"; then
    echo "kept     $name"
    return
  fi
  local file
  file="$(mktemp)"
  printf '%s' "$value" > "$file"
  # Windows AWS CLI under Git Bash needs a Windows path for file:// arguments.
  local cli_file="$file"
  command -v cygpath >/dev/null 2>&1 && cli_file="$(cygpath -w "$file")"
  aws ssm put-parameter --region "$REGION" --name "$name" --type SecureString \
    --description "$description" --value "file://$cli_file" --tags Key=project,Value=usage-poc >/dev/null
  rm -f "$file"
  echo "created  $name"
}

token() {
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
}

create "$PREFIX/mcp-service-token" "$(token)" "usage-poc serverless: portal <-> agent shared token"
create "$PREFIX/ingest-token" "$(token)" "usage-poc serverless: Tracker HTTPS ingest bearer token"
create "$PREFIX/openai-api-key" "REPLACE_ME" "usage-poc serverless: OpenAI API key for the AI agent"
