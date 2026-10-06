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

Then:

- Restart the AI agent so its Service Connect proxy learns the portal's address
  (the agent started in phase 1, before the portal service existed):
  `aws ecs update-service --cluster usage-poc --service ai-agent --force-new-deployment`
- Re-run `scripts\install-aws-poc.ps1` on each laptop (the broker address changes;
  the CA does not).
- Check `allowedCidrs` in `cdk.json` against `curl https://checkip.amazonaws.com`
  before deploying; dynamic ISP addresses change often.
- The portal URL (CloudFront domain) changes with each redeploy; read `PortalUrl`
  from the stack outputs. If `atlas` reports "session expired", run `atlas auth login`. Generated secrets (RabbitMQ passwords, service token)
are regenerated by each redeploy; the scripts and stack pick them up.

---

# Low-cost Docker variant: `UsagePocEc2`

The same four containers (portal, telemetry worker, AI agent, RabbitMQ) and the
same images as `UsagePoc`, run by Docker Compose on one `t3.small` instance
instead of ECS Fargate. There is no NAT gateway, load balancer or EFS, which
puts it at about $20/month instead of about $90. Deployed and destroyed independently
of `UsagePoc`.

| | `UsagePoc` (ECS) | `UsagePocEc2` |
|---|---|---|
| Portal entry | CloudFront → VPC origin → internal ALB | CloudFront → instance port 80 (CloudFront prefix list only, plus a secret `X-Origin-Verify` header the portal checks) |
| Broker entry | NLB :5671 | Elastic IP :5671 |
| Atlas egress | NAT gateway IP | instance Elastic IP |
| `/api/mcp` blocked | ALB rule | CloudFront function |
| RabbitMQ data | EFS | instance disk (Docker volume) |
| Restart/healing | ECS services, rolling deploys | Docker `restart: unless-stopped`; one instance, so brief downtime on updates |

Both variants use the same Atlas database, broker CA (`usage-poc/rabbitmq-tls`)
and OpenAI key. The EC2 stack's own secrets are under `usage-poc-ec2/`.

```bash
cd infra
npx cdk deploy UsagePocEc2 --require-approval never --asset-parallelism=false
```

```powershell
# (Atlas login required) allow the instance's IP; its own label leaves the ECS NAT entry alone.
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-atlas.ps1 -AccessListOnly -NatIp <PublicIp> -Comment 'usage-poc EC2 instance'
```

The portal container restarts on its own until Atlas accepts the IP. Point a
laptop at this variant (a laptop sends to one broker at a time):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-aws-poc.ps1 -StackName UsagePocEc2 -TrackerSecretId usage-poc-ec2/rabbitmq-tracker
```

Operations:

- Shell: `aws ssm start-session --target <InstanceId>` (Session Manager plugin
  required), then `sudo docker compose --project-directory /opt/usage-poc ps`.
- Logs: CloudWatch `/usage-poc-ec2/{portal,worker,agent,rabbitmq}`; setup log
  `/var/log/usage-poc-setup.log` on the instance.
- Updates: any code or stack change replaces the instance (new user data). The
  Elastic IP moves to the new instance, so Atlas and laptops need no change.
  Messages still queued in RabbitMQ at that moment are lost. Laptops only delete
  samples the broker has confirmed, and the worker drains the queue within seconds.
- Shut down: `npx cdk destroy UsagePocEc2 --force` (releases the Elastic IP and
  removes the `usage-poc-ec2/*` secrets; the shared secrets and Atlas data stay).
