// import { RedisClientType } from 'redis';
import { redis } from './redis';

const HISTORY_PREFIX = 'llm:history:'; // Namespace das chaves

export interface IHistory {
  getHistory(number: string): Promise<any[]>;
  saveHistory(number: string, history: any[]): Promise<void>;
  addToHistory(number: string, message: any): Promise<void>;
  clearHistory(number: string): Promise<void>;
}

export class RedisHistory implements IHistory {
  private redis: any;
  constructor() {
    this.redis = redis;
  }
  async getHistory(number: string): Promise<any[]> {
    const raw = await this.redis.get(HISTORY_PREFIX + number);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  
  async saveHistory(number: string, history: any[]): Promise<void> {
    await this.redis.set(HISTORY_PREFIX + number, JSON.stringify(history), { EX: 60 * 60 * 12 }); // expira em 12h
  }

  async addToHistory(number: string, message: any): Promise<void> {
    const history = await this.getHistory(number);
    history.push(message);
    await this.saveHistory(number, history); // <- faltou isso!
  }

  async clearHistory(number: string): Promise<void> {
    await this.redis.del(HISTORY_PREFIX + number);
  }
}