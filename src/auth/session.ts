// Web Crypto (funciona em Node e em qualquer runtime do Next).
export const SESSION_COOKIE = "gc_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 14;

const enc = new TextEncoder();

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Devolve null se não for base64url válido (nunca lança).
function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  if (!secret) throw new Error("Segredo de sessão vazio.");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(data));
}

// Comparação em tempo constante de dois digests de tamanho fixo (32 bytes).
function digestsEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = String(now + SESSION_MAX_AGE_S * 1000);
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  try {
    if (!token || !secret) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, sig] = parts as [string, string];
    if (!/^\d{1,16}$/.test(payload)) return false;
    const sigBytes = fromBase64Url(sig);
    if (!sigBytes) return false;
    // crypto.subtle.verify compara a assinatura em tempo constante.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sigBytes, enc.encode(payload));
    return ok && Number(payload) > now;
  } catch {
    return false;
  }
}

// Compara digests HMAC (tamanho fixo) das duas senhas: tempo constante e sem vazar o tamanho.
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  return digestsEqual(await hmac("password-check", input), await hmac("password-check", expected));
}
