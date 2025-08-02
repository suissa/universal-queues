import fs from 'fs/promises';
import path from 'path';

// Diretório e arquivo padrão de auditoria DLQ
const DLQ_AUDIT_DIR = process.env.DLQ_AUDIT_DIR || './dlq_audit';
const DLQ_AUDIT_FILE = path.join(DLQ_AUDIT_DIR, `dlq_${new Date().toISOString().slice(0, 10)}.log`);

/**
 * Handler padrão para mensagens enviadas à Dead Letter Queue (DLQ).
 * - Log estruturado no console.
 * - Persistência em arquivo para auditoria/futuro replay/manual review.
 * - Emite evento local (pronto para integração com sistemas de monitoramento).
 */
export async function defaultDlqHandler(msg: any, context?: { queue?: string; exchange?: string; error?: any; }) {
  const now = new Date();
  const dlqEvent = {
    timestamp: now.toISOString(),
    queue: context?.queue,
    exchange: context?.exchange,
    error: context?.error ? (context.error instanceof Error ? context.error.message : String(context.error)) : undefined,
    message: msg
  };

  // Log estruturado no console (para Prometheus/Grafana/Splunk/etc)
  console.warn('[DLQ]', JSON.stringify(dlqEvent, null, 2));

  // Persistência em arquivo para auditoria (replay/manual review)
  try {
    await fs.mkdir(DLQ_AUDIT_DIR, { recursive: true });
    await fs.appendFile(DLQ_AUDIT_FILE, JSON.stringify(dlqEvent) + '\n');
  } catch (fileErr) {
    console.error('[DLQ][ERROR] Falha ao salvar em arquivo de auditoria:', fileErr);
  }

  // Exemplo de emissão de evento local (pronto para hook futuro)
  // if (typeof process.emit === 'function') {
  //   process.emit('dlq_event', dlqEvent);
  // }

  // Futuro: integração com Sentry, Slack, email, etc.
}
