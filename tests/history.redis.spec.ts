import { HistoryFactory } from '../src/index';

// Pode usar outro número se quiser
const numero = '5515999999999';

describe('RedisHistory', () => {
  const history = HistoryFactory.create('redis');

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
