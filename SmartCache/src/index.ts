import type { RedisClientType } from 'redis';
import { createClient } from 'redis';

export interface HistoryMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export interface HistoryProvider {
  getHistory(identifier: string): Promise<HistoryMessage[]>;
  saveHistory(identifier: string, history: HistoryMessage[]): Promise<void>;
  addToHistory(identifier: string, message: HistoryMessage): Promise<void>;
  clearHistory(identifier: string): Promise<void>;
}

export interface RedisHistoryOptions {
  /** Prefix utilizado nas chaves armazenadas no Redis. */
  prefix?: string;
  /** Tempo em segundos para expiração automática do histórico. */
  ttlSeconds?: number;
  /** Cliente Redis já conectado. */
  client?: RedisClientType;
  /** URL utilizada para criar um novo cliente Redis quando nenhum é fornecido. */
  url?: string;
}

const DEFAULT_PREFIX = 'llm:history:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 12; // 12 horas
const DEFAULT_URL = 'redis://127.0.0.1:6379';

export class RedisHistory implements HistoryProvider {
  private readonly redis: RedisClientType;
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(options: RedisHistoryOptions = {}) {
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    this.redis = options.client ?? createClient({ url: options.url ?? process.env.REDIS_URL ?? DEFAULT_URL });

    this.redis.on('error', (err) => {
      console.error('❌ Redis error:', err);
    });

    if (!this.redis.isOpen) {
      void this.redis.connect().catch((err) => {
        console.error('❌ Failed to connect to Redis:', err);
      });
    }
  }

  private buildKey(identifier: string): string {
    return `${this.prefix}${identifier}`;
  }

  async getHistory(identifier: string): Promise<HistoryMessage[]> {
    const raw = await this.redis.get(this.buildKey(identifier));
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as HistoryMessage[];
      }
      return [];
    } catch {
      return [];
    }
  }

  async saveHistory(identifier: string, history: HistoryMessage[]): Promise<void> {
    await this.redis.set(this.buildKey(identifier), JSON.stringify(history), {
      EX: this.ttlSeconds,
    });
  }

  async addToHistory(identifier: string, message: HistoryMessage): Promise<void> {
    const history = await this.getHistory(identifier);
    history.push(message);
    await this.saveHistory(identifier, history);
  }

  async clearHistory(identifier: string): Promise<void> {
    await this.redis.del(this.buildKey(identifier));
  }
}

export const SmartCache = {
  createRedisHistory(options?: RedisHistoryOptions): RedisHistory {
    return new RedisHistory(options);
  },
};

export default SmartCache;
