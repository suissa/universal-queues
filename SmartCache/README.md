# SmartCache

Biblioteca minimalista para persistir o histórico de conversas de assistentes LLM em Redis.

## Instalação

```bash
npm install @suissa/smart-cache
```

## Uso

```ts
import { SmartCache } from '@suissa/smart-cache';

const history = SmartCache.createRedisHistory();
await history.addToHistory('5515999999999', { role: 'user', content: 'Olá!' });
```

## Configuração

Você pode personalizar o prefixo das chaves, o TTL do histórico e reutilizar um cliente Redis já conectado:

```ts
import { createClient } from 'redis';
import { SmartCache } from '@suissa/smart-cache';

const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

const history = SmartCache.createRedisHistory({
  prefix: 'bot:history:',
  ttlSeconds: 60 * 60,
  client,
});
```

## Scripts Disponíveis

- `npm run build` – gera os arquivos em JavaScript dentro da pasta `dist`.
- `npm test` – executa os testes automatizados com Jest.

## Licença

MIT
