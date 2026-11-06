import { afterEach, describe, expect, it, vi } from "vitest";

const createProviders = vi.fn();
vi.mock("@/providers", () => ({ createProviders: (...a: unknown[]) => createProviders(...a) }));

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __gcContext?: unknown }).__gcContext;
  createProviders.mockReset();
});

function stubEnv() {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5434/x");
  vi.stubEnv("PROVIDER", "fake");
  vi.stubEnv("ACCESS_PASSWORD", "pw");
  vi.stubEnv("SESSION_SECRET", "s".repeat(40));
}

describe("getContext", () => {
  it("não deixa a rejeição em cache: a próxima chamada tenta de novo", async () => {
    stubEnv();
    const { getContext } = await import("@/web/context");
    createProviders.mockRejectedValueOnce(new Error("ffmpeg ausente")).mockResolvedValueOnce({});
    await expect(getContext()).rejects.toThrow("ffmpeg ausente");
    const ok = await getContext();
    expect(ok.env.PROVIDER).toBe("fake");
    expect(createProviders).toHaveBeenCalledTimes(2);
    expect(await getContext()).toBe(ok); // sucesso fica em cache
    expect(createProviders).toHaveBeenCalledTimes(2);
  });
});
