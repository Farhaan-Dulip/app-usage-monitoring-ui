#!/usr/bin/env bash
# Builds the portal UI and publishes it to the UsagePocServerless Amplify app
# as a manual deployment (no Git connection needed).
#
#   bash infra/scripts/deploy-serverless-ui.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1

STACK="${STACK:-UsagePocServerless}"
REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text | tr -d '\r'
}
APP_ID="$(output AmplifyAppId)"
BRANCH="$(output AmplifyBranch)"
echo "Amplify app $APP_ID, branch $BRANCH"

echo "Building UI..."
(cd "$ROOT" && VITE_API_BASE_URL= npm run build >/dev/null)

ZIP="$(mktemp -u).zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$ROOT/dist" && zip -qr "$ZIP" .)
else
  ZIP_WIN="$(cygpath -w "$ZIP")"
  DIST_WIN="$(cygpath -w "$ROOT/dist")"
  powershell -NoProfile -Command "Compress-Archive -Path '$DIST_WIN\\*' -DestinationPath '$ZIP_WIN' -Force"
fi

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment --region "$REGION" --app-id "$APP_ID" \
  --branch-name "$BRANCH" --query "[jobId,zipUploadUrl]" --output text | tr -d '\r')
echo "Uploading build (job $JOB_ID)..."
# Windows curl.exe (and the AWS CLI) need Windows paths under Git Bash.
UPLOAD_FILE="$ZIP"
command -v cygpath >/dev/null 2>&1 && UPLOAD_FILE="$(cygpath -w "$ZIP")"
curl -sS --fail --upload-file "$UPLOAD_FILE" -H "Content-Type: application/zip" "$UPLOAD_URL" >/dev/null
rm -f "$ZIP"
aws amplify start-deployment --region "$REGION" --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null

for _ in $(seq 1 60); do
  STATUS="$(aws amplify get-job --region "$REGION" --app-id "$APP_ID" --branch-name "$BRANCH" \
    --job-id "$JOB_ID" --query job.summary.status --output text | tr -d '\r')"
  case "$STATUS" in
    SUCCEED) echo "Deployed: $(output PortalUrl)"; exit 0 ;;
    FAILED|CANCELLED) echo "Amplify deployment $STATUS" >&2; exit 1 ;;
  esac
  sleep 5
done
echo "Timed out waiting for Amplify job $JOB_ID" >&2
exit 1
