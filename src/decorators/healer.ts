import { HealingToolkit } from '../healing/toolkit';

type HealerOptions = {
  toolkit?: HealingToolkit;
  retryOnHeal?: boolean;
};

/**
 * Decorator resiliente que captura qualquer exceção lançada pelo método
 * decorado e tenta auto-corrigir via HealingToolkit. Nunca deixa o erro
 * vazar para o usuário e, quando possível, reexecuta a operação após o
 * processo de cura.
 */
export function Healer(options: HealerOptions = {}): MethodDecorator {
  const { toolkit = HealingToolkit.global(), retryOnHeal = true } = options;

  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        const healed = await toolkit.heal(error);
        if (healed && retryOnHeal) {
          try {
            return await originalMethod.apply(this, args);
          } catch (retryError) {
            await toolkit.reportCapabilities(retryError);
            return toolkit.fallbackValue(retryError);
          }
        }

        await toolkit.reportCapabilities(error);
        return toolkit.fallbackValue(error);
      }
    };

    return descriptor;
  };
}
