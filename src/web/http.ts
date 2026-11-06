import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "@/auth/session";
import type { Env } from "@/config/env";
import type { Deps } from "@/deps";
import { DomainError } from "@/services/errors";
import { getContext } from "./context";

// Cabeçalhos de toda resposta com arquivo do usuário (rotas de arquivo da Task 3): nunca cache público, sem sniffing.
export const FILE_HEADERS = {
  "Cache-Control": "private, max-age=3600",
  "X-Content-Type-Options": "nosniff",
} as const;
export const JSON_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

// Falha fechado: qualquer erro (cookie ausente, segredo vazio, contexto indisponível) conta como não autenticado.
export async function isAuthedCookie(cookieHeader: string | null): Promise<boolean> {
  try {
    const { env } = await getContext();
    return await verifySession(readCookie(cookieHeader, SESSION_COOKIE), env.SESSION_SECRET);
  } catch {
    return false;
  }
}

type ApiArgs = { req: Request; params: Record<string, string>; deps: Deps; env: Env };
type RouteCtx = { params: Promise<Record<string, string>> };

const uuid = z.guid(); // qualquer id no formato 8-4-4-4-12; evita que um id malformado chegue ao Postgres

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: JSON_HEADERS });

// Resumo em pt-BR (as mensagens nativas do Zod são em inglês).
export function describeZodError(e: z.ZodError): string {
  const parts = e.issues.slice(0, 5).map((i) => {
    const field = i.path.length ? i.path.map(String).join(".") : "corpo da requisição";
    let why: string;
    switch (i.code) {
      case "invalid_type":
        // O Zod v4 não expõe o valor recebido na issue; a mensagem nativa traz "received undefined" quando falta o campo.
        why = /received undefined/.test(i.message) ? "campo obrigatório" : "tipo inválido";
        break;
      case "too_small":
        why = "valor curto ou pequeno demais";
        break;
      case "too_big":
        why = "valor longo ou grande demais";
        break;
      case "invalid_value":
        why = "valor não permitido";
        break;
      case "invalid_format":
        why = "formato inválido";
        break;
      case "unrecognized_keys":
        why = "campo não reconhecido";
        break;
      default:
        why = "valor inválido";
    }
    return `${field}: ${why}`;
  });
  return `Dados inválidos (${parts.join("; ")})`;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defesa de CSRF além do SameSite do cookie: em métodos que alteram estado, bloqueia requisições vindas de outra origem.
// Sem Sec-Fetch-Site nem Origin (curl, testes, navegadores antigos em same-origin) a requisição segue.
export function isCrossOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (origin === null) return false;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

// Envolve um endpoint: autentica (fail closed), valida ids da URL, converte erros em JSON pt-BR.
// `auth: false` existe só para a rota de login; toda outra rota exige a sessão.
export function api(handler: (a: ApiArgs) => Promise<unknown>, opts: { auth?: boolean } = {}) {
  return async (req: Request, ctx?: RouteCtx): Promise<Response> => {
    // Falha ao montar o contexto (env inválido, ffmpeg ausente...) é erro de servidor, nunca "dados inválidos"
    // (um ZodError do loadEnv não pode virar 400 nem vazar nomes de variáveis).
    let context: Awaited<ReturnType<typeof getContext>>;
    try {
      context = await getContext();
    } catch (e) {
      console.error("Falha ao montar o contexto da aplicação:", e instanceof Error ? e.message : "erro desconhecido");
      return json({ error: "Erro interno do servidor. Tente novamente." }, 500);
    }
    const { deps, env } = context;
    try {
      if (opts.auth !== false) {
        let ok = false;
        try {
          ok = await verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE), env.SESSION_SECRET);
        } catch {
          ok = false;
        }
        if (!ok) return json({ error: "Não autorizado" }, 401);
      }
      // Vale também para auth:false (login é um POST que altera estado).
      if (isCrossOrigin(req)) return json({ error: "Requisição bloqueada por segurança (origem diferente)." }, 403);
      const params = ctx?.params ? await ctx.params : {};
      for (const v of Object.values(params)) {
        if (!uuid.safeParse(v).success) throw new DomainError("Identificador inválido", 400);
      }
      const out = await handler({ req, params, deps, env });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof DomainError) return json({ error: e.message }, e.status);
      if (e instanceof z.ZodError) return json({ error: describeZodError(e) }, 400);
      if (e instanceof SyntaxError && /JSON/i.test(e.message)) return json({ error: "Corpo da requisição inválido" }, 400);
      console.error(e);
      return json({ error: "Erro interno do servidor. Tente novamente." }, 500);
    }
  };
}
