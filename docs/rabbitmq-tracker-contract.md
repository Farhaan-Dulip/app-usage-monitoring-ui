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
