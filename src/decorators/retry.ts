export function Retry(
  retries = 3,
  delayMs = 1000,
  onError?: (e: any, attempt: number) => void
): MethodDecorator {
  return function (_target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      let attempt = 0;
      let lastError: any;
      while (attempt < retries) {
        try {
          return await originalMethod.apply(this, args);
        } catch (e) {
          attempt++;
          lastError = e;
          if (onError) onError(e, attempt);
          if (attempt < retries) await new Promise(res => setTimeout(res, delayMs));
        }
      }
      throw lastError;
    };
    return descriptor;
  };
}
