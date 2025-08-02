import amqplib, { ConsumeMessage } from 'amqplib';
import { IMessaging } from './interfaces/IMessaging';
import { Retry } from './decorators/retry';

export class RabbitMQClient implements IMessaging {
  private connection!: any;
  private channel!: any;

  async connect(uri: string) {
    this.connection = await amqplib.connect(uri);
    this.channel = await this.connection.createChannel();
  }

  @Retry(3, 1000)
  async publishEvent(
    exchange: string,
    routingKey: string,
    message: object,
    headers: any = {}
  ) {
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    this.channel.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { headers, persistent: true }
    );
  }

  async subscribeToEvent(
    exchange: string,
    queue: string,
    routingKey: string,
    handler: (msg: any) => void
  ) {
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    await this.channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: `${exchange}.dlq`
    });
    await this.channel.bindQueue(queue, exchange, routingKey);

    this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          handler(content);
          this.ackMessage(msg);
        } catch (err) {
          this.nackMessage(msg);
        }
      }
    });
  }

  async publishToFanout(exchange: string, message: object) {
    await this.channel.assertExchange(exchange, 'fanout', { durable: true });
    this.channel.publish(exchange, '', Buffer.from(JSON.stringify(message)));
  }

  async subscribeToFanout(
    exchange: string,
    handler: (msg: any) => void
  ) {
    await this.channel.assertExchange(exchange, 'fanout', { durable: true });
    const q = await this.channel.assertQueue('', { exclusive: true });
    await this.channel.bindQueue(q.queue, exchange, '');

    this.channel.consume(q.queue, (msg: ConsumeMessage | null) => {
      if (msg) {
        handler(JSON.parse(msg.content.toString()));
        this.ackMessage(msg);
      }
    });
  }

  async publishToOutbox(event: object) {
    console.log('[OUTBOX]', event);
  }

  async handleDeadLetter(
    dlqExchange: string,
    dlqQueue: string,
    handler: (msg: any) => void
  ) {
    await this.channel.assertExchange(dlqExchange, 'fanout', { durable: true });
    await this.channel.assertQueue(dlqQueue, { durable: true });
    await this.channel.bindQueue(dlqQueue, dlqExchange, '');

    this.channel.consume(dlqQueue, (msg: ConsumeMessage | null) => {
      if (msg) {
        handler(JSON.parse(msg.content.toString()));
        this.ackMessage(msg);
      }
    });
  }

  ackMessage(msg: ConsumeMessage) {
    this.channel.ack(msg);
  }

  nackMessage(msg: ConsumeMessage, requeue = false) {
    this.channel.nack(msg, false, requeue);
  }

  async close() {
    await this.channel.close();
    await this.connection.close();
  }
}
