import { execFile } from 'child_process';
import path from 'path';
import { HealingScriptBuilder } from './fluent-interface';

type HealAction = (error: unknown) => Promise<boolean>;

/**
 * Núcleo de auto-correção do sistema. Executa heurísticas para sanar falhas
 * (ex.: reconectar ao RabbitMQ, garantir topologia, iniciar docker). Mantém
 * uma lista de capacidades divulgadas ao usuário caso a cura automática não
 * seja suficiente.
 */
export class HealingToolkit {
  private static singleton: HealingToolkit;
  private readonly healers: HealAction[] = [];
  private readonly capabilities: string[] = [
    'Reconectar ao broker e reabrir canais fechados',
    'Recriar exchanges, filas e bindings ausentes',
    'Guardar mensagens em buffer para reenvio posterior',
    'Gatilhar script de correção automática (docker) quando o broker estiver offline'
  ];

  static global() {
    if (!HealingToolkit.singleton) {
      HealingToolkit.singleton = new HealingToolkit();
    }
    return HealingToolkit.singleton;
  }

  constructor() {
    this.register(this.tryHealDocker.bind(this));
  }

  register(action: HealAction) {
    this.healers.push(action);
    return this;
  }

  async heal(error: unknown): Promise<boolean> {
    for (const healer of this.healers) {
      try {
        const resolved = await healer(error);
        if (resolved) return true;
      } catch (_ignored) {
        // Nunca deixar a cura explodir
      }
    }
    return false;
  }

  async reportCapabilities(error: unknown) {
    const builder = new HealingScriptBuilder()
      .forError(error instanceof Error ? error.message : String(error))
      .describe('Sistema auto-curável pronto para aplicar correções')
      .addCommand('bash scripts/heal-docker.sh');

    console.info('[HEALER] Nenhuma cura automática finalizada. Capacidades disponíveis:', this.capabilities);
    console.info('[HEALER] Para registrar correção definitiva, use FluentInterface:', builder.summary());
  }

  fallbackValue(error: unknown) {
    return {
      healed: false,
      error: error instanceof Error ? error.message : String(error),
      capabilities: this.capabilities
    };
  }

  private async tryHealDocker(error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ECONNREFUSED|ENOTFOUND|socket|connect|broker/i.test(message)) return false;

    const scriptPath = path.join(process.cwd(), 'scripts', 'heal-docker.sh');
    await new Promise<void>((resolve) => {
      execFile('bash', [scriptPath], { env: process.env }, () => resolve());
    });
    return true;
  }
}
