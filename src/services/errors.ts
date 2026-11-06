// Violação de regra de negócio. `status` é o código HTTP que a API devolve.
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
