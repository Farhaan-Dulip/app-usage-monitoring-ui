// Publishes approved-license config updates (device_config_outbox) to the
// Trackers. Runs inside the telemetry worker, which already holds the broker
// connection; the portal only writes the outbox, so an approval never fails
// because RabbitMQ is briefly unavailable.
export const CONFIG_EXCHANGE = 'tracker.config';

export function deviceQueueName(deviceId) {
  return `tracker.config.${deviceId}`;
}

// Publishes pending grants with publisher confirms. The device's durable queue
// is declared and bound first, so the update waits for a PC that is off or has
// not connected yet (a direct exchange drops unroutable messages).
export async function publishPendingGrants({ channel, outbox, logger = console, now = () => new Date() }) {
  const pending = await outbox.find({ status: 'pending' }).limit(20).toArray();
  let sent = 0;
  for (const grant of pending) {
    try {
      const queue = deviceQueueName(grant.deviceId);
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, CONFIG_EXCHANGE, grant.deviceId);
      channel.publish(CONFIG_EXCHANGE, grant.deviceId, Buffer.from(JSON.stringify(grant.message)), {
        persistent: true,
        contentType: 'application/json',
        messageId: grant.grantId,
      });
      await channel.waitForConfirms();
      await outbox.updateOne({ _id: grant._id }, { $set: { status: 'sent', sentAt: now() } });
      logger.log(`License config for ${grant.message?.app?.name} sent to ${grant.pcName} (${grant.deviceId}).`);
      sent += 1;
    } catch (error) {
      await outbox.updateOne(
        { _id: grant._id },
        { $set: { lastError: String(error.message || error).slice(0, 500), lastAttemptAt: now() }, $inc: { attempts: 1 } }
      ).catch(() => undefined);
      throw error; // channel errors close the channel; the worker restarts and retries
    }
  }
  return sent;
}

export async function startConfigPublisher({ connection, outbox, logger = console, intervalMs = 5000 }) {
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(CONFIG_EXCHANGE, 'direct', { durable: true });
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await publishPendingGrants({ channel, outbox, logger });
    } catch (error) {
      logger.error(`License config publish failed: ${error.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  channel.on('close', () => clearInterval(timer));
  logger.log('License config publisher is running.');
  return { channel, stop: () => clearInterval(timer) };
}
