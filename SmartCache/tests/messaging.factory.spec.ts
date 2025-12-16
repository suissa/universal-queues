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

describe('MessagingFactory - TDD', () => {
  it("deve retornar uma instância de RabbitMQClient quando o tipo é 'rabbitmq'", () => {
    const messaging = MessagingFactory.create('rabbitmq');

    expect(messaging).toBeInstanceOf(RabbitMQClient);
  });

  it('deve usar rabbitmq como padrão quando nenhum tipo é informado', () => {
    const messaging = MessagingFactory.create();

    expect(messaging).toBeInstanceOf(RabbitMQClient);
  });

  it('deve lançar erro quando o tipo não é suportado', () => {
    expect(() => MessagingFactory.create('kafka' as any)).toThrow(
      'Mensageria não suportada: kafka'
    );
  });
});
