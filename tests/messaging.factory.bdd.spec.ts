jest.mock('../src/clients/redis', () => {
  const redisMock = {
    on: jest.fn(),
    isOpen: true,
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  };
  return { redis: redisMock };
});

import { MessagingFactory } from '../src/index';
import { RabbitMQClient } from '../src/rabbitmq';

describe('MessagingFactory - BDD', () => {
  describe('Cenário: Publicar evento de pedido criado usando RabbitMQ', () => {
    let messaging: RabbitMQClient;
    let channelMock: {
      assertExchange: jest.Mock;
      publish: jest.Mock;
    };

    beforeEach(() => {
      messaging = MessagingFactory.create('rabbitmq') as RabbitMQClient;
      channelMock = {
        assertExchange: jest.fn().mockResolvedValue(undefined),
        publish: jest.fn()
      };

      (messaging as any).channel = channelMock;
    });

    it('Dado um serviço de pedidos conectado ao RabbitMQ, quando um pedido é criado, então o evento é publicado na exchange correta', async () => {
      const exchange = 'orders.events';
      const routingKey = 'order.created';
      const event = {
        orderId: 'pedido-123',
        total: 125.5,
        customerId: 'cliente-456'
      };
      const headers = { correlationId: 'corr-789' };

      await messaging.publishEvent(exchange, routingKey, event, headers);

      expect(channelMock.assertExchange).toHaveBeenCalledWith(exchange, 'topic', {
        durable: true
      });
      expect(channelMock.publish).toHaveBeenCalledWith(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(event)),
        { headers, persistent: true }
      );
    });
  });
});
