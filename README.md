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
