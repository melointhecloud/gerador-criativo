import { z } from "zod";
import { createSession, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/auth/session";
import { DomainError } from "@/services/errors";
import { api, JSON_HEADERS } from "@/web/http";
import { loginThrottle } from "@/web/login-throttle";

// Única rota sem sessão. Mensagem de erro genérica: não revela nada além de "senha incorreta".
export const POST = api(
  async ({ req, env }) => {
    // Conta a tentativa antes de qualquer trabalho caro (ler o corpo, checar a senha): ver login-throttle.ts.
    const attempt = loginThrottle.attempt();
    if (attempt.blocked) {
      return Response.json(
        { error: "Muitas tentativas. Tente novamente em alguns minutos." },
        { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(attempt.retryAfterS) } },
      );
    }
    const { password } = z.object({ password: z.string().max(500) }).parse(await req.json());
    if (!(await passwordMatches(password, env.ACCESS_PASSWORD))) {
      if (loginThrottle.failDelayMs > 0) await new Promise((r) => setTimeout(r, loginThrottle.failDelayMs));
      throw new DomainError("Senha incorreta", 401);
    }
    loginThrottle.undo();
    const token = await createSession(env.SESSION_SECRET);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
        },
      },
    );
  },
  { auth: false },
);
