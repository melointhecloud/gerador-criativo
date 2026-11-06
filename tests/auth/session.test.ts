import { describe, expect, it } from "vitest";
import { createSession, passwordMatches, SESSION_MAX_AGE_S, verifySession } from "@/auth/session";

const secret = "s".repeat(40);

describe("sessão", () => {
  it("aceita um token recém-criado", async () => {
    expect(await verifySession(await createSession(secret), secret)).toBe(true);
  });
  it("rejeita token adulterado", async () => {
    const t = await createSession(secret);
    const [exp, sig] = t.split(".");
    expect(await verifySession(`${Number(exp) + 1000}.${sig}`, secret)).toBe(false);
    expect(await verifySession(`${exp}.${sig!.slice(0, -2)}xx`, secret)).toBe(false);
  });
  it("rejeita segredo diferente, token vazio e token malformado", async () => {
    const t = await createSession(secret);
    expect(await verifySession(t, "outro".repeat(10))).toBe(false);
    expect(await verifySession(undefined, secret)).toBe(false);
    expect(await verifySession("sem-ponto", secret)).toBe(false);
  });
  it("rejeita token expirado", async () => {
    const t = await createSession(secret, Date.now() - 15 * 24 * 3600 * 1000);
    expect(await verifySession(t, secret)).toBe(false);
  });
});

describe("sessão: tokens malformados e segredo", () => {
  it("rejeita sem lançar: partes demais, base64 inválido, expiração não numérica", async () => {
    const t = await createSession(secret);
    const [exp, sig] = t.split(".");
    expect(await verifySession(`${exp}.${sig}.extra`, secret)).toBe(false);
    expect(await verifySession(`${exp}.!!!`, secret)).toBe(false);
    expect(await verifySession(`${exp}.`, secret)).toBe(false);
    expect(await verifySession(`abc.${sig}`, secret)).toBe(false);
    expect(await verifySession(`-5.${sig}`, secret)).toBe(false);
    expect(await verifySession(".", secret)).toBe(false);
  });
  it("não aceita segredo vazio", async () => {
    await expect(createSession("")).rejects.toThrow();
    const t = await createSession(secret);
    expect(await verifySession(t, "")).toBe(false);
  });
  it("expira exatamente no limite", async () => {
    const now = 1_700_000_000_000;
    const t = await createSession(secret, now);
    const exp = now + SESSION_MAX_AGE_S * 1000;
    expect(await verifySession(t, secret, exp - 1)).toBe(true);
    expect(await verifySession(t, secret, exp)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compara a senha", async () => {
    expect(await passwordMatches("segredo", "segredo")).toBe(true);
    expect(await passwordMatches("errada", "segredo")).toBe(false);
    expect(await passwordMatches("", "segredo")).toBe(false);
    expect(await passwordMatches("segredo-mais-longo", "segredo")).toBe(false);
  });
});
