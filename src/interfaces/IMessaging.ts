export interface IMessaging {
  connect(uri: string): Promise<void>;
  publishEvent(exchange: string, routingKey: string, message: object, headers?: object): Promise<void>;
  subscribeToEvent(exchange: string, queue: string, routingKey: string, handler: (msg: any) => void): Promise<void>;
  publishToFanout(exchange: string, message: object): Promise<void>;
  subscribeToFanout(exchange: string, handler: (msg: any) => void): Promise<void>;
  publishToOutbox(event: object): Promise<void>;
  handleDeadLetter(dlqExchange: string, dlqQueue: string, handler: (msg: any) => void): Promise<void>;
  close(): Promise<void>;
}
