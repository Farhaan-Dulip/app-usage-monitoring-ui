# App Usage Monitoring UI

A simple React + Vite dashboard for inspecting telemetry payloads from the app usage monitor.

## Setup

1. Open a terminal in `C:\Users\FarhanDulip\Documents\app-usage-monitoring-ui`
2. Run `npm install`
3. Start the local email backend with `npm run start:server`
4. In a separate terminal, run `npm run dev`

The backend persists portal records and telemetry in MongoDB. It defaults to
`mongodb://localhost:27017/app-usage-monitoring`; override this with the
`MONGO_URI` and `MONGO_DATABASE` environment variables.

To copy data from the previous wrapper-document schema in
`app-license-monitoring` into the normalized collections, run `npm run migrate:mongo`.
The migration is idempotent and leaves the source database unchanged.

## RabbitMQ telemetry pipeline

The User Tracker can publish telemetry directly to RabbitMQ instead of relying on the UI's
periodic local HTTP polling. The portal consumes the messages and writes them to MongoDB.

For local development, start RabbitMQ:

```powershell
docker compose up -d rabbitmq
```

RabbitMQ Management is available at `http://localhost:15672` (default local credentials:
`portal` / `portal_dev`). Start the independent MongoDB persistence worker with:

```powershell
npm run start:telemetry-consumer
```

Copy `.env.example` values into `.env` as appropriate. The User Tracker publish contract is
documented in [docs/rabbitmq-tracker-contract.md](docs/rabbitmq-tracker-contract.md).

The existing `/api/telemetry` endpoint remains available temporarily while trackers migrate.

## Assistant request workflow

The **AI Assistant** screen is the in-app entry point for license workflows. It can answer
questions through the separate `app-usage-monitor-agent` LLM service and creates a `pending_approval` record when a user enters an
explicit request such as `Submit a request for a Postman license.` It does not allocate a
license automatically.

Run the monitoring agent on port `3002` locally, and keep `ASSISTANT_AGENT_URL` set to
`http://localhost:3002/api/assistant/chat`. The browser calls only the portal; the portal
calls the agent server-side. If the agent is unavailable, the portal falls back to its
database-only answers.

The agent has no MongoDB connection. Give both services the same long random
`MCP_SERVICE_TOKEN`; the agent uses it to call the portal's private `/api/mcp/*` endpoints
for license metrics. Set `PORTAL_API_URL=http://localhost:3000` in the agent environment.

Requests are currently associated with the portal browser session (`X-Client-Id`). Before
production use, place the portal behind an identity provider and replace that session value
with the authenticated user's immutable ID and authorization roles.

## AWS deployment (ECS Fargate + MongoDB Atlas)

The included `Dockerfile` builds the Vite UI and serves it from the Express backend, so the
browser and API can share one HTTPS origin. This avoids production CORS and hard-coded
localhost issues.

1. Create a MongoDB Atlas cluster (or Amazon DocumentDB-compatible endpoint) and allow
   network access only from the ECS task security group.
2. Create an Amazon ECR repository, then authenticate, build, and push the image:

   ```powershell
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker build -t app-usage-monitoring-ui .
   docker tag app-usage-monitoring-ui:latest <account>.dkr.ecr.<region>.amazonaws.com/app-usage-monitoring-ui:latest
   docker push <account>.dkr.ecr.<region>.amazonaws.com/app-usage-monitoring-ui:latest
   ```

3. Create an ECS Fargate task definition using that image, exposing container port `3000`.
   Supply `MONGO_URI`, `MONGO_DATABASE`, `APP_TIME_ZONE`, and `CORS_ORIGIN` as task
   environment variables. Store the MongoDB connection string in AWS Secrets Manager.
4. Run the task in private subnets behind an Application Load Balancer. Terminate TLS on the
   load balancer with an ACM certificate and route port 443 to the container's port 3000.
5. Create an ECS service with at least two tasks across availability zones. Enable CloudWatch
   logs and set a health check against an application endpoint before exposing it publicly.

Deploy `app-usage-monitor-agent` as a separate private ECS service and set
`ASSISTANT_AGENT_URL` in the portal task to its private Cloud Map or internal load-balancer
URL. Give the agent task the OpenAI API key through Secrets Manager; never place it in the UI
or portal task image.

SES email settings are optional and are not required for the chat and approval workflow.

## AWS SES Email Summary

The app now uses AWS SES to send evaluation window summaries.

Required configuration:

- `AWS_REGION` (or `aws_region` in `src/app_config.json`)
- `SES_SOURCE_EMAIL` (or `ses_source_email` in `src/app_config.json`)
- AWS credentials via `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` or an AWS IAM role

You can set environment variables in a `.env` file or your shell.

Example `.env`:

```
AWS_REGION=us-east-1
SES_SOURCE_EMAIL=no-reply@alliontechnologies.com
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
```

## Usage

- Paste telemetry JSON in the editor
- Click **Load telemetry**
- The dashboard will show device information and usage details
- At the end of the configured evaluation window, the app will request SES to send a summary email to the address in `src/app_config.json`

## Notes

- This project uses Vite and React.
- The UI is intentionally lightweight for quick local testing.
