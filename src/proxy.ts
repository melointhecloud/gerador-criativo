import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideGate } from "@/web/page-gate";

// Portão central das páginas: sem sessão válida, tudo vai para /login. Fica de fora (ver `isGatedPath`):
// /login, /api/** (responde 401 em JSON via `api()`), /_next/**, e qualquer caminho com ponto (favicon, estáticos).
export async function proxy(request: NextRequest) {
  const d = await decideGate({
    pathname: request.nextUrl.pathname,
    cookie: request.headers.get("cookie"),
    secret: process.env.SESSION_SECRET,
  });
  if (d.action === "redirect") return NextResponse.redirect(new URL(d.to, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login(?:/|$)|api(?:/|$)|_next(?:/|$)|.*\\..*).*)"],
};
