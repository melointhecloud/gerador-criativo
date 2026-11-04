import { createDb } from "@/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/gerador_test";

const { db, sql } = createDb(TEST_DATABASE_URL, 5);

export const testDb = db;

export async function resetDb() {
  await sql.unsafe(
    "TRUNCATE projects, assets, characters, scenes, scene_references, scene_attempts, jobs RESTART IDENTITY CASCADE",
  );
}
