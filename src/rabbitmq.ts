import amqplib, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { IMessaging } from './interfaces/IMessaging';
import { Retry } from './decorators/retry';
import { Healer } from './decorators/healer';
import { HealingToolkit } from './healing/toolkit';
import { Tool } from './tool';

type BufferedMessage = {
  exchange: string;
  routingKey: string;
  message: object;
  headers?: any;
};

export class RabbitMQClient implements IMessaging {
  private connection?: ChannelModel;
  private channel?: Channel;
  private uri?: string;
  private reconnecting = false;
  private readonly messageBuffer: BufferedMessage[] = [];
  private readonly topicSubscriptions: {
    exchange: string;
    queue: string;
    routingKey: string;
    handler: (msg: any) => void;
  }[] = [];
  private readonly fanoutSubscriptions: {
    exchange: string;
    handler: (msg: any) => void;
  }[] = [];
  private readonly deadLetterSubscriptions: {
    dlqExchange: string;
    dlqQueue: string;
    handler: (msg: any) => void;
  }[] = [];
  private readonly healer = HealingToolkit.global();

  @Healer()
  async connect(uri: string) {
    this.uri = uri;
    await this.establishConnection();
  }

  @Healer()
  @Retry(3, 1000)
  async publishEvent(
    exchange: string,
    routingKey: string,
    message: object,
    headers: any = {}
  ) {
    const payload = Buffer.from(JSON.stringify(message));
    try {
      await this.ensureChannel();
      await this.assertTopicTopology(exchange, routingKey);
      this.channel!.publish(exchange, routingKey, payload, { headers, persistent: true });
    } catch (error) {
      this.channel = undefined;
      this.connection = undefined;
      this.bufferMessage({ exchange, routingKey, message, headers });
      throw error;
    }
  }

  async pub(
    exchange: string,
    routingKey: string,
    message: object,
    headers: any = {}
  ) {
    return this.publishEvent(exchange, routingKey, message, headers);
  }

  @Healer()
  async subscribeToEvent(
    exchange: string,
    queue: string,
    routingKey: string,
    handler: (msg: any) => void
  ) {
    const subscription = { exchange, queue, routingKey, handler };
    await this.setupTopicSubscription(subscription);
    this.topicSubscriptions.push(subscription);
  }

  async sub(
    exchange: string,
    queue: string,
    routingKey: string,
    handler: (msg: any) => void
  ) {
    return this.subscribeToEvent(exchange, queue, routingKey, handler);
  }

  @Healer()
  async publishToFanout(exchange: string, message: object) {
    await this.ensureChannel();
    await this.channel!.assertExchange(exchange, 'fanout', { durable: true });
    this.channel!.publish(exchange, '', Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  @Healer()
  async subscribeToFanout(exchange: string, handler: (msg: any) => void) {
    const subscription = { exchange, handler };
    await this.setupFanoutSubscription(subscription);
    this.fanoutSubscriptions.push(subscription);
  }

  async publishToOutbox(event: object) {
    console.log('[OUTBOX]', event);
  }

  @Healer()
  async handleDeadLetter(
    dlqExchange: string,
    dlqQueue: string,
    handler: (msg: any) => void
  ) {
    const subscription = { dlqExchange, dlqQueue, handler };
    await this.setupDeadLetterSubscription(subscription);
    this.deadLetterSubscriptions.push(subscription);
  }

  ackMessage(msg: ConsumeMessage) {
    this.channel?.ack(msg);
  }

  nackMessage(msg: ConsumeMessage, requeue = false) {
    this.channel?.nack(msg, false, requeue);
  }

  @Healer()
  async close() {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }

  private async establishConnection() {
    if (!this.uri) throw new Error('RabbitMQ URI não configurada');
    this.connection = await amqplib.connect(this.uri);
    this.connection.on('close', () => this.handleDisconnect());
    this.connection.on('error', () => this.handleDisconnect());
    this.channel = await this.connection.createChannel();
    this.reconnecting = false;
    await this.reattachSubscriptions();
    await this.flushBuffer();
  }

  private async ensureChannel() {
    if (this.channel) return this.channel;
    await this.establishConnection();
    return this.channel!;
  }

  private async assertTopicTopology(exchange: string, routingKey: string) {
    await this.channel!.assertExchange(exchange, 'topic', { durable: true });
    // Bind implícito garantido via queue, mas manter método para simetria
    if (routingKey === '#') {
      await this.channel!.assertExchange(`${exchange}.catchall`, 'topic', { durable: true });
    }
  }

  private bufferMessage(message: BufferedMessage) {
    this.messageBuffer.push(message);
  }

  private async flushBuffer() {
    if (!this.channel || this.messageBuffer.length === 0) return;
    const pending = [...this.messageBuffer];
    this.messageBuffer.length = 0;
    for (const item of pending) {
      try {
        await this.publishEvent(item.exchange, item.routingKey, item.message, item.headers);
      } catch (_err) {
        // Se ainda falhar, devolve ao buffer e segue
        this.bufferMessage(item);
      }
    }
  }

  private async handleDisconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    if (this.uri) {
      this.channel = undefined;
      this.connection = undefined;
      await this.healer.heal(new Error('Conexão com RabbitMQ perdida'));
      setTimeout(() => {
        this.establishConnection().catch(() => {
          this.reconnecting = false;
        });
      }, 500);
    }
  }

  private async setupTopicSubscription(subscription: {
    exchange: string;
    queue: string;
    routingKey: string;
    handler: (msg: any) => void;
  }) {
    await this.ensureChannel();
    await this.assertTopicTopology(subscription.exchange, subscription.routingKey);
    await this.channel!.assertQueue(subscription.queue, {
      durable: true,
      deadLetterExchange: `${subscription.exchange}.dlq`
    });
    await this.channel!.bindQueue(subscription.queue, subscription.exchange, subscription.routingKey);

    this.channel!.consume(subscription.queue, async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const content = JSON.parse(msg.content.toString());
        await Promise.resolve(subscription.handler(content));
        this.ackMessage(msg);
      } catch (err) {
        await this.pub(
          'payload.originAgent',
          '',
          Tool.createPayload({
            errors: err,
            schema: msg.properties?.headers || {},
            example: { routingKey: msg.fields.routingKey, raw: msg.content.toString() }
          })
        );
        this.nackMessage(msg);
      }
    });
  }

  private async setupFanoutSubscription(subscription: { exchange: string; handler: (msg: any) => void }) {
    await this.ensureChannel();
    await this.channel!.assertExchange(subscription.exchange, 'fanout', { durable: true });
    const q = await this.channel!.assertQueue('', { exclusive: true });
    await this.channel!.bindQueue(q.queue, subscription.exchange, '');

    this.channel!.consume(q.queue, (msg: ConsumeMessage | null) => {
      if (msg) {
        subscription.handler(JSON.parse(msg.content.toString()));
        this.ackMessage(msg);
      }
    });
  }

  private async setupDeadLetterSubscription(subscription: {
    dlqExchange: string;
    dlqQueue: string;
    handler: (msg: any) => void;
  }) {
    await this.ensureChannel();
    await this.channel!.assertExchange(subscription.dlqExchange, 'fanout', { durable: true });
    await this.channel!.assertQueue(subscription.dlqQueue, { durable: true });
    await this.channel!.bindQueue(subscription.dlqQueue, subscription.dlqExchange, '');

    this.channel!.consume(subscription.dlqQueue, (msg: ConsumeMessage | null) => {
      if (msg) {
        subscription.handler(JSON.parse(msg.content.toString()));
        this.ackMessage(msg);
      }
    });
  }

  private async reattachSubscriptions() {
    for (const subscription of this.topicSubscriptions) {
      await this.setupTopicSubscription(subscription);
    }

    for (const subscription of this.fanoutSubscriptions) {
      await this.setupFanoutSubscription(subscription);
    }

    for (const subscription of this.deadLetterSubscriptions) {
      await this.setupDeadLetterSubscription(subscription);
    }
  }
}
