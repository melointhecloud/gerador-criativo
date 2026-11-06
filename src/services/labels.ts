import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assets, characters } from "@/db/schema";
import { DomainError } from "./errors";

// Rótulos identificam imagens de referência e personagens no roteiro; precisam ser únicos no projeto.
export async function assertLabelFree(db: Db, projectId: string, label: string, exceptCharacterId?: string) {
  const key = label.trim().toLowerCase();
  const refs = await db
    .select({ label: assets.label })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.kind, "reference"), isNotNull(assets.label)));
  const chars = await db
    .select({ name: characters.name })
    .from(characters)
    .where(
      exceptCharacterId
        ? and(eq(characters.projectId, projectId), ne(characters.id, exceptCharacterId))
        : eq(characters.projectId, projectId),
    );
  const taken = [...refs.map((r) => r.label!), ...chars.map((c) => c.name)];
  if (taken.some((t) => t.trim().toLowerCase() === key)) {
    throw new DomainError(`Já existe uma referência ou personagem chamado "${label.trim()}"`);
  }
}
