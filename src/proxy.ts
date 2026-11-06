import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideGate } from "@/web/page-gate";

// Portão central das páginas: sem sessão válida, tudo vai para /login. Fica de fora (ver `isGatedPath`):
// /login, /api/** (responde 401 em JSON via `api()`), /_next/**, e arquivos estáticos conhecidos (favicon, imagens, txt, xml, css, js, map, fontes).
export async function proxy(request: NextRequest) {
  const d = await decideGate({
    pathname: request.nextUrl.pathname,
    cookie: request.headers.get("cookie"),
    secret: process.env.SESSION_SECRET,
  });
  if (d.action === "redirect") {
    // Clona nextUrl (origem que o Next resolveu): `request.url` pode trazer o host interno atrás do Railway/Docker.
    const url = request.nextUrl.clone();
    url.pathname = d.to;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Literal estático (o Next o analisa em build); a lista de extensões deve ser igual à de `isGatedPath` (teste confere).
  matcher: ["/((?!login(?:/|$)|api(?:/|$)|_next(?:/|$)|.*\\.(?:ico|png|jpe?g|gif|svg|webp|txt|xml|css|js|map|woff2?)$).*)"],
};
