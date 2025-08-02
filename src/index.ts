import { IMessaging } from './interfaces/IMessaging';
import { RabbitMQClient } from './rabbitmq';

export class MessagingFactory {
  static create(type: 'rabbitmq' = 'rabbitmq'): IMessaging {
    if (type === 'rabbitmq') return new RabbitMQClient();
    // Futuro: if (type === 'kafka') return new KafkaClient();
    throw new Error(`Mensageria não suportada: ${type}`);
  }
}
