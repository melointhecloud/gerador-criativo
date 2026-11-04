// Handler pede para ser reexecutado depois, sem gastar tentativa (ex.: geração ainda em andamento).
export class RetryLater extends Error {
  constructor(public readonly delayMs: number) {
    super(`retry in ${delayMs}ms`);
    this.name = "RetryLater";
  }
}

// Erro definitivo: não adianta tentar de novo.
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}
