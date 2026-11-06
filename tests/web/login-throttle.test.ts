import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "@/web/login-throttle";

describe("login throttle", () => {
  it("bloqueia após 10 falhas na janela e libera quando ela expira", () => {
    let t = 1000;
    const th = createLoginThrottle({ now: () => t });
    for (let i = 0; i < 9; i++) th.fail();
    expect(th.check().blocked).toBe(false);
    th.fail();
    const r = th.check();
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.retryAfterS).toBe(900);
    t += 15 * 60 * 1000 - 1;
    expect(th.check().blocked).toBe(true);
    t += 1;
    expect(th.check().blocked).toBe(false);
  });

  it("sucesso zera o contador", () => {
    const th = createLoginThrottle({ now: () => 0 });
    for (let i = 0; i < 9; i++) th.fail();
    th.success();
    for (let i = 0; i < 9; i++) th.fail();
    expect(th.check().blocked).toBe(false);
  });
});
