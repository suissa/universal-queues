import { IMessaging } from './interfaces/IMessaging';
import { RabbitMQClient } from './rabbitmq';
import { RedisHistory, IHistory } from './clients/history.redis';

export class MessagingFactory {
  static create(type: 'rabbitmq' = 'rabbitmq'): IMessaging {
    if (type === 'rabbitmq') return new RabbitMQClient();
    // Futuro: if (type === 'kafka') return new KafkaClient();
    throw new Error(`Mensageria não suportada: ${type}`);
  }
}


export class HistoryFactory {
  static create(type: 'redis' = 'redis'): IHistory {
    if (type === 'redis') return new RedisHistory();
    throw new Error(`Cache não suportada: ${type}`);
  }
}
