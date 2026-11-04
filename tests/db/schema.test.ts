import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, projects, sceneAttempts, scenes } from "@/db/schema";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

describe("schema", () => {
  it("cria projeto com defaults e apaga filhos em cascata", async () => {
    const [p] = await db.insert(projects).values({ name: "Teste", mode: "ugc" }).returning();
    expect(p!.stage).toBe("briefing");
    expect(p!.copy).toBe("");

    const [s] = await db
      .insert(scenes)
      .values({ projectId: p!.id, position: 0, visualPrompt: "v", targetSeconds: 5 })
      .returning();
    await db.insert(sceneAttempts).values({ sceneId: s!.id, prompt: "p" });
    await db.insert(assets).values({
      projectId: p!.id, kind: "reference", storageKey: "k", mimeType: "image/png",
    });

    await db.delete(projects).where(eq(projects.id, p!.id));

    expect(await db.select().from(scenes)).toHaveLength(0);
    expect(await db.select().from(sceneAttempts)).toHaveLength(0);
    expect(await db.select().from(assets)).toHaveLength(0);
  });
});
