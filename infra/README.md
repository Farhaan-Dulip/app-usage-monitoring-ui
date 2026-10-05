# usage-poc AWS infrastructure (CDK)

POC deployment of the portal, telemetry worker, AI agent and a self-run RabbitMQ
on ECS Fargate in `us-east-1`. Everything is tagged `project=usage-poc` and is
removed by `npx cdk destroy` (except the MongoDB Atlas cluster, which lives
outside AWS, and the broker TLS secret created by the script).

```
Laptops (Tracker) --AMQPS 5671--> NLB --> rabbitmq (Fargate, EFS data)
Browser --HTTPS--> CloudFront (IP allow-list) --VPC origin--> internal ALB --> portal
portal <--Service Connect--> ai-agent --> OpenAI          worker <-- rabbitmq:5672
portal / worker --> NAT (fixed IP) --> MongoDB Atlas
```

Known accepted gaps are tracked in [`../docs/known-gaps.md`](../docs/known-gaps.md).

## One-time setup

1. **Install and bootstrap CDK** (once per account/region):

   ```bash
   cd infra && npm ci
   npx cdk bootstrap aws://978387602501/us-east-1
   ```

2. **Broker TLS (private CA)** - creates the CA under `~/.usage-poc/broker-tls`
   (outside the repo) and stores ca/cert/key in Secrets Manager:

   ```bash
   bash scripts/generate-broker-tls.sh --upload
   ```

   Put the printed `brokerTlsSecretArn` into `cdk.json` context. Keep `ca.key`
   private; distribute only `ca.pem` to laptops.

3. **Allowed portal IPs** - set `allowedCidrs` in `cdk.json` (comma-separated IPv4
   CIDRs). The portal has no login yet (gap S1), so this is the only gate.

## Deploy

```bash
npx cdk diff     # review
npx cdk deploy
```

First deploy runs with `appsEnabled=false`: broker, agent, networking, CloudFront
and secrets are created, while portal and worker stay at 0 tasks until MongoDB
is configured.

## Enable the portal and worker

1. Create a MongoDB Atlas cluster (M0 is enough for the POC) and add the stack
   output `NatPublicIp` to its IP access list.
2. Store secrets without putting them in shell history or chat, e.g. from a
   file you delete afterwards:

   ```bash
   aws secretsmanager put-secret-value --secret-id usage-poc/mongo-uri --secret-string file://mongo-uri.txt
   aws secretsmanager put-secret-value --secret-id usage-poc/openai-api-key --secret-string file://openai-key.txt
   ```

3. Set `"appsEnabled": true` in `cdk.json` and run `npx cdk deploy` again.
   After changing a secret later, restart the affected service:

   ```bash
   aws ecs update-service --cluster usage-poc --service ai-agent --force-new-deployment
   ```

## Connect a Tracker laptop

From the stack outputs and secrets:

| Variable | Value |
|---|---|
| `RABBITMQ_URL` | `amqps://tracker:<usage-poc/rabbitmq-tracker>@<BrokerHost>:5671/app_usage` |
| `RABBITMQ_CA_FILE` | path to `ca.pem` copied to the laptop |
| `RABBITMQ_TLS_SERVER_NAME` | `mq.usage-poc.internal` (output `TrackerTlsServerName`) |
| `TENANT_ID` | `default` |

The Tracker must run in the logged-in user's session (e.g. a Task Scheduler
"at logon" task), not as a Windows service: it reads the foreground window.

## Operations

- Logs: CloudWatch log groups `/usage-poc/{portal,worker,agent,broker}` (14 days).
- Alarms: SNS topic `usage-poc-alarms` (set `alarmEmail` in `cdk.json` to subscribe).
- RabbitMQ management UI (not public): ECS Exec into the `rabbitmq` task, or
  port-forward 15672 with Session Manager.
- Broker deploys stop the old task before starting the new one (shared EFS
  data); Trackers buffer telemetry locally during the ~1-2 minute gap.

---

# Pay-per-use variant: `UsagePocServerless`

A second, independent stack with nothing billed by the hour. The container stack
above is unaffected; both can run side by side (each has its own data).

```
Browser --HTTPS + password--> Amplify Hosting (UI) --/api/* proxy--> portal Lambda (Express) --> DynamoDB
portal Lambda <--function URLs + service token--> AI agent Lambda --> OpenAI
Laptops (Tracker, TELEMETRY_TRANSPORT=https) --bearer token--> ingest Lambda --> DynamoDB (30-day TTL)
```

The portal runs the same `server.js` on `DATA_STORE=dynamodb`
(`services/dynamoDatabase.js` emulates the MongoDB operations the portal uses;
`test/storeParity.test.js` runs one scenario against both stores). Secrets are
SSM SecureString parameters under `/usage-poc-sls/` (free tier); only the
Amplify password is in Secrets Manager because CloudFormation must read it.

## Deploy

```bash
bash infra/scripts/setup-serverless-secrets.sh        # once: tokens + OpenAI placeholder
(cd infra && npx cdk deploy UsagePocServerless)
bash infra/scripts/deploy-serverless-ui.sh            # build + publish the UI to Amplify
```

Set the OpenAI key from a file you delete afterwards:

```bash
aws ssm put-parameter --overwrite --type SecureString --name /usage-poc-sls/openai-api-key --value file://openai-key.txt
```

Lambda functions read parameters at cold start: warm instances keep the old
value until recycled. To apply a new value now, force fresh instances, e.g.
`aws lambda update-function-configuration --function-name <AiAgent function> --description "reload secrets"`.

Portal login: user `usage-poc`, password in the Secrets Manager secret named in
the `PortalLogin` stack output.

## Laptops

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-aws-poc.ps1 -Target Serverless
```

(from the Tracker repo; re-run without `-Target` to switch back to RabbitMQ).

## Cost when idle

DynamoDB on-demand, Lambda, Amplify Hosting and SSM standard parameters bill
only for use; idle cost is about $0.40/month (the Amplify password secret) plus
log/table storage. `npx cdk destroy UsagePocServerless` removes it, including
the DynamoDB data.

---

# Shut down and redeploy the container stack (`UsagePoc`)

Shutting down removes everything that bills by the hour:

```bash
cd infra && npx cdk destroy UsagePoc --force
```

Kept on purpose (≈ $1.20/month): the Atlas cluster and its data, the
`usage-poc/shared/mongo-uri` and `usage-poc/shared/openai-api-key` secrets
(referenced through `cdk.json` context), and the broker TLS secret
`usage-poc/rabbitmq-tls`, so laptops' `ca.pem` stays valid. The NAT gateway's
Elastic IP is released; a redeploy gets a new one.

Redeploy in two phases, because Atlas only accepts the NAT IP and the portal and
worker would crash-loop (and roll the deployment back) until it is allowed:

```bash
cd infra
# 1. Everything except portal + worker; note the NatPublicIp output.
npx cdk deploy UsagePoc -c appsEnabled=false --require-approval never --asset-parallelism=false
```

```powershell
# 2. (Atlas login required) allow the new NAT IP and remove the old one.
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-atlas.ps1 -AccessListOnly -NatIp <NatPublicIp>
```

```bash
# 3. Start portal + worker (appsEnabled=true is the cdk.json default).
npx cdk deploy UsagePoc --require-approval never --asset-parallelism=false
```

Then re-run `scripts\install-aws-poc.ps1` on each laptop (the broker address
changes; the CA does not) and update `allowedCidrs` in `cdk.json` first if your
public IP has changed. Generated secrets (RabbitMQ passwords, service token)
are regenerated by each redeploy; the scripts and stack pick them up.
