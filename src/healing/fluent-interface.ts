/**
 * Interface fluente para registrar correções definitivas. Permite ao usuário
 * anexar comandos shell que a IA poderá reaplicar para garantir que o erro
 * não volte a ocorrer.
 */
export class HealingScriptBuilder {
  private context: { error?: string; description?: string; commands: string[] } = {
    commands: []
  };

  forError(error: string) {
    this.context.error = error;
    return this;
  }

  describe(description: string) {
    this.context.description = description;
    return this;
  }

  addCommand(command: string) {
    this.context.commands.push(command);
    return this;
  }

  summary() {
    return {
      error: this.context.error,
      description: this.context.description,
      commands: this.context.commands
    };
  }
}
