import { SESSION_COOKIE, verifySession } from "@/auth/session";
import { readCookie } from "@/web/cookie";

// Portão central das páginas (usado por src/proxy.ts). Rotas de API ficam de fora: `api()` já responde 401 em JSON.
// Mantenha em sincronia com `config.matcher` de src/proxy.ts (há teste cobrindo os dois). Só extensões estáticas conhecidas
// ficam de fora: um caminho com ponto qualquer (ex.: /projects/abc.def) continua sob o portão.
// Sensível a maiúsculas de propósito: o Next compila o matcher com `i` (/LOGIN pula o proxy), mas esses caminhos são 404.
export function isGatedPath(pathname: string): boolean {
  if (/^\/(login|api|_next)(\/|$)/.test(pathname)) return false;
  if (/\.(?:ico|png|jpe?g|gif|svg|webp|txt|xml|css|js|map|woff2?)$/.test(pathname)) return false; // favicon e estáticos
  return true;
}

export type GateDecision = { action: "allow" } | { action: "redirect"; to: "/login" };

// Falha fechado: qualquer erro, cookie ausente ou segredo vazio vira redirecionamento para /login.
export async function decideGate(a: { pathname: string; cookie: string | null; secret: string | undefined }): Promise<GateDecision> {
  if (!isGatedPath(a.pathname)) return { action: "allow" };
  try {
    if (await verifySession(readCookie(a.cookie, SESSION_COOKIE), a.secret ?? "")) return { action: "allow" };
  } catch {
    // cai no redirecionamento
  }
  return { action: "redirect", to: "/login" };
}
