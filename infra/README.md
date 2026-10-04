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
