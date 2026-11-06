import { SESSION_COOKIE } from "@/auth/session";
import { api } from "@/web/http";

export const POST = api(async () => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` } },
  );
});
