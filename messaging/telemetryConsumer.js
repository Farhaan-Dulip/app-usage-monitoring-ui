import amqp from 'amqplib';
import { persistTelemetry, validateTelemetryPayload } from '../services/telemetryPersistence.js';

const exchangeName = process.env.RABBITMQ_TELEMETRY_EXCHANGE || 'tracker.telemetry';
const queueName = process.env.RABBITMQ_TELEMETRY_QUEUE || 'portal.telemetry.persist';
const deadLetterExchange = `${exchangeName}.dlx`;
const deadLetterQueue = `${queueName}.dlq`;

function connectionUrl() {
  return process.env.RABBITMQ_URL || 'amqp://portal:portal_dev@localhost:5672/app_usage';
}

export async function startTelemetryConsumer({ telemetryEvents, logger = console }) {
  const connection = await amqp.connect(connectionUrl());
  const channel = await connection.createChannel();

  await channel.assertExchange(exchangeName, 'topic', { durable: true });
  await channel.assertExchange(deadLetterExchange, 'topic', { durable: true });
  await channel.assertQueue(deadLetterQueue, { durable: true });
  await channel.bindQueue(deadLetterQueue, deadLetterExchange, '#');
  await channel.assertQueue(queueName, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': deadLetterExchange },
  });
  await channel.bindQueue(queueName, exchangeName, 'telemetry.#');
  await channel.prefetch(Number(process.env.RABBITMQ_PREFETCH) || 25);

  channel.consume(queueName, async (message) => {
    if (!message) return;
    try {
      const payload = JSON.parse(message.content.toString('utf8'));
      validateTelemetryPayload(payload);
      await persistTelemetry(telemetryEvents, payload, 'rabbitmq');
      channel.ack(message);
    } catch (error) {
      const invalidPayload = error instanceof SyntaxError || /Telemetry must|timestamp must/.test(error.message);
      logger.error(`RabbitMQ telemetry message failed: ${error.message}`);
      channel.nack(message, false, !invalidPayload);
    }
  });

  connection.on('error', (error) => logger.error(`RabbitMQ connection error: ${error.message}`));
  connection.on('close', () => logger.error('RabbitMQ connection closed; restart the consumer to reconnect.'));
  logger.log(`RabbitMQ telemetry consumer is listening on ${queueName}.`);
  return { connection, channel };
}
