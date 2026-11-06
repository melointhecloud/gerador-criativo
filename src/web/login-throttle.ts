// Freio simples de tentativas de login, em memória (o serviço `web` roda com 1 réplica).
// Contador global (não por IP): X-Forwarded-For é forjável e o time é pequeno. Um atacante pode, no pior caso,
// travar o login por 15 min; isso é aceito em troca de impedir força bruta.
export type Throttle = {
  failDelayMs: number;
  check(): { blocked: false } | { blocked: true; retryAfterS: number };
  fail(): void;
  success(): void;
  reset(): void;
};

export function createLoginThrottle(opts: { max?: number; windowMs?: number; now?: () => number; failDelayMs?: number } = {}): Throttle {
  const max = opts.max ?? 10;
  const windowMs = opts.windowMs ?? 15 * 60 * 1000;
  const now = opts.now ?? Date.now;
  let count = 0;
  let windowStart = 0;

  const expire = () => {
    if (count > 0 && now() - windowStart >= windowMs) count = 0;
  };

  return {
    failDelayMs: opts.failDelayMs ?? 300,
    check() {
      expire();
      if (count >= max) return { blocked: true, retryAfterS: Math.max(1, Math.ceil((windowStart + windowMs - now()) / 1000)) };
      return { blocked: false };
    },
    fail() {
      expire();
      if (count === 0) windowStart = now();
      count += 1;
    },
    success() {
      count = 0;
    },
    reset() {
      count = 0;
    },
  };
}

export const loginThrottle: Throttle = createLoginThrottle();
