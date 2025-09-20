import { SmartCache } from '../src/index';

class FakeRedisClient {
  private store = new Map<string, string>();
  isOpen = true;

  on() {
    return this;
  }

  async connect() {
    this.isOpen = true;
  }

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.store.set(key, value);
  }

  async del(key: string) {
    this.store.delete(key);
  }
}

const numero = '5515999999999';

describe('RedisHistory (SmartCache)', () => {
  const fakeClient = new FakeRedisClient();
  const history = SmartCache.createRedisHistory({ ttlSeconds: 60, client: fakeClient as any });

  beforeAll(async () => {
    await history.clearHistory(numero);
  });

  afterAll(async () => {
    await history.clearHistory(numero);
  });

  it('deve adicionar mensagens ao histórico', async () => {
    await history.addToHistory(numero, { role: 'user', content: 'Mensagem 1' });
    await history.addToHistory(numero, { role: 'assistant', content: 'Resposta 1' });

    const hist = await history.getHistory(numero);
    expect(hist.length).toBe(2);
    expect(hist[0]).toEqual({ role: 'user', content: 'Mensagem 1' });
    expect(hist[1]).toEqual({ role: 'assistant', content: 'Resposta 1' });
  });

  it('deve salvar e recuperar histórico manualmente', async () => {
    const fakeHistory = [
      { role: 'user', content: 'Início' },
      { role: 'assistant', content: 'Olá' },
    ];
    await history.saveHistory(numero, fakeHistory);

    const hist = await history.getHistory(numero);
    expect(hist).toEqual(fakeHistory);
  });

  it('deve limpar o histórico', async () => {
    await history.saveHistory(numero, [{ role: 'user', content: 'Limpar!' }]);
    await history.clearHistory(numero);

    const hist = await history.getHistory(numero);
    expect(hist).toEqual([]);
  });
});
