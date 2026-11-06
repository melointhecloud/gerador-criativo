import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "@/web/login-throttle";

describe("login throttle", () => {
  it("attempt conta na hora: bloqueia na tentativa seguinte ao limite e libera quando a janela expira", () => {
    let t = 1000;
    const th = createLoginThrottle({ max: 3, now: () => t });
    for (let i = 0; i < 3; i++) expect(th.attempt().blocked).toBe(false);
    const r = th.attempt();
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.retryAfterS).toBe(900);
    t += 15 * 60 * 1000 - 1;
    expect(th.attempt().blocked).toBe(true);
    t += 1;
    expect(th.attempt().blocked).toBe(false); // janela nova, contador zerado
  });

  it("o limite padrão é 30 tentativas por janela de 15 minutos", () => {
    const th = createLoginThrottle({ now: () => 0 });
    for (let i = 0; i < 30; i++) expect(th.attempt().blocked).toBe(false);
    const r = th.attempt();
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.retryAfterS).toBe(900);
  });

  it("undo desfaz só a tentativa corrente (não zera o contador) e nunca passa de zero", () => {
    const th = createLoginThrottle({ max: 3, now: () => 0 });
    th.attempt();
    th.attempt();
    th.attempt(); // 3 no contador
    th.undo(); // 2
    expect(th.attempt().blocked).toBe(false); // 3
    expect(th.attempt().blocked).toBe(true);
    const fresh = createLoginThrottle({ max: 1, now: () => 0 });
    fresh.undo();
    fresh.undo();
    expect(fresh.attempt().blocked).toBe(false);
    expect(fresh.attempt().blocked).toBe(true);
  });

  it("o contador recomeça do zero ao expirar a janela e undo nunca fica abaixo de zero", () => {
    let t = 0;
    const th = createLoginThrottle({ max: 2, now: () => t });
    th.attempt();
    t += 15 * 60 * 1000;
    th.attempt(); // janela nova, contador 1
    th.undo(); // 1 -> 0
    th.undo(); // continua em 0
    expect(th.attempt().blocked).toBe(false);
    expect(th.attempt().blocked).toBe(false);
    expect(th.attempt().blocked).toBe(true);
  });
});
