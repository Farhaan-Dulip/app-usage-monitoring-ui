# User Tracker telemetry contract

The User Tracker publishes one JSON message for each collected telemetry sample.

## Connection

- Broker URL: `RABBITMQ_URL`
- Exchange: `tracker.telemetry` (type: `topic`, durable)
- Routing key: `telemetry.<tenant_id>.<device_id>`
- Delivery mode: persistent
- Publisher confirms: enabled

## Required message fields

```json
{
  "event_id": "2f130b68-4102-49c4-85b1-55d40e77aaf3",
  "schema_version": 1,
  "tenant_id": "allion",
  "device_id": "dc759e404daee85fd8e5826b5c0cee78",
  "device_name": "AT-NB-FARHAND",
  "timestamp": "2026-09-27T09:15:00+05:30",
  "usage": []
}
```

`timestamp` must be an ISO 8601 date/time. The current portal deduplicates messages using
`device_id` and `timestamp`; retain `event_id` now so the tracker can move to event-ID
deduplication later without changing the message shape.

## Delivery rules

1. Publish persistent messages to the topic exchange.
2. Wait for the broker publisher-confirm before removing a sample from the tracker outbox.
3. Keep an on-disk tracker outbox for messages that cannot be confirmed.
4. Retry broker connections with exponential backoff.
5. Never publish credentials or user secrets in telemetry payloads.

The portal consumer only acknowledges a RabbitMQ delivery after MongoDB has written it.
Malformed messages are routed to `portal.telemetry.persist.dlq` for investigation.

## Config updates to the Tracker

The portal sends config to a Tracker through the `tracker.config` direct
exchange, routing key = device ID. Each device has a durable queue
`tracker.config.<device_id>`, which holds updates while the PC is off. The
telemetry worker publishes them from the `device_config_outbox` collection.

| Message | Sent when | Tracker does |
|---|---|---|
| `config_deployed` | Deploy Tracker on the Tracker Management page | Replaces the portal-owned keys of monitoring-config.json (`target_pc`, `assigned_user`, `generated_at`, `licensed_apps`, `extensions`, `tracked_urls`) and keeps everything else |
| `license_granted` | An app owner approves a license request | Adds the one app if it isn't monitored yet |

`config_deployed` example:

```json
{
  "type": "config_deployed",
  "deployment_id": "deploy-at-nb-01-1794060254096",
  "device_id": "dc759e404daee85fd8e5826b5c0cee78",
  "pc_name": "AT-NB-01",
  "assigned_user": "ava@alliontechnologies.com",
  "deployed_at": "2026-11-07T14:04:14.096Z",
  "config": {
    "target_pc": "AT-NB-01",
    "assigned_user": "ava@alliontechnologies.com",
    "licensed_apps": [{
      "name": "claude.exe",
      "type": "application",
      "subscriptionType": "Claude",
      "license_cost": 25,
      "reclaim_policy": { "evaluation_window_seconds": 2592000, "worked_threshold_seconds": 28800, "idle_threshold_seconds": 4 },
      "extensions": []
    }],
    "extensions": [],
    "tracked_urls": []
  }
}
```

- A PC that hasn't connected yet has no device ID. Its deployment waits
  (`waiting_device`) and is released when the PC first reports in under that
  name. A newer deployment to the same PC supersedes one not sent yet.
- The Tracker ignores a redelivered `deployment_id` and any deployment older
  than the one it last applied.
- Vendor activity fields in a policy (e.g. Postman "signed in within 14 days")
  are not sent to the Tracker. The backend checks them per deployed user
  (`GET /api/vendor-rule-results`) against the vendor's data.
