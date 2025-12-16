type PayloadInput = {
  errors?: unknown;
  schema?: any;
  example?: Record<string, any>;
};

function normalizeKey(key: string) {
  return key
    .replace(/[^a-zA-Z0-9]+(.)/g, (_m, chr) => chr.toUpperCase())
    .replace(/\s+/g, '')
    .replace(/^./, (c) => c.toLowerCase());
}

function sanitizeValue(value: any) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return value.trim();
  if (Number.isNaN(value)) return null;
  return value;
}

export class Tool {
  /**
   * Gera um payload robusto mesmo com schemas incorretos. Normaliza campos,
   * tenta auto-corrigir nomes e valores e, se algo falhar, devolve tudo no
   * atributo `unresolved` para que nada se perca.
   */
  static createPayload(input: PayloadInput) {
    const safeSchema = typeof input.schema === 'object' && input.schema ? input.schema : {};
    const sample = input.example && typeof input.example === 'object' ? input.example : {};

    const healed: Record<string, any> = {};
    const unresolved: Record<string, any> = {};

    const entries = Object.entries({ ...safeSchema, ...sample });
    for (const [rawKey, rawValue] of entries) {
      const key = normalizeKey(String(rawKey));
      const value = sanitizeValue(rawValue);
      if (key) {
        healed[key] = value;
      } else {
        unresolved[rawKey] = rawValue;
      }
    }

    return {
      originAgent: 'self-healing-tool',
      timestamp: new Date().toISOString(),
      errors: input.errors,
      data: healed,
      unresolved
    };
  }
}
