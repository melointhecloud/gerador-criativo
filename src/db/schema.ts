import {
  boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import type { Mode, Stage } from "../domain/stages";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable("projects", {
  id: id(),
  name: text("name").notNull(),
  mode: text("mode").$type<Mode>().notNull(),
  copy: text("copy").notNull().default(""),
  stage: text("stage").$type<Stage>().notNull().default("briefing"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AssetKind = "reference" | "character" | "clip" | "final";

export const assets = pgTable("assets", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AssetKind>().notNull(),
  label: text("label"),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: createdAt(),
});

export const characters = pgTable("characters", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  position: integer("position").notNull().default(0),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  approved: boolean("approved").notNull().default(false),
  imageStatus: text("image_status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
  imageError: text("image_error"),
  createdAt: createdAt(),
});

export const scenes = pgTable("scenes", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  dialogue: text("dialogue").notNull().default(""),
  visualPrompt: text("visual_prompt").notNull(),
  targetSeconds: integer("target_seconds").notNull(),
  notice: text("notice"),
  approvedAttemptId: uuid("approved_attempt_id"),
  createdAt: createdAt(),
});

export const sceneReferences = pgTable(
  "scene_references",
  {
    sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.assetId] })],
);

export type AttemptStatus = "queued" | "generating" | "done" | "failed" | "blocked";

export const sceneAttempts = pgTable("scene_attempts", {
  id: id(),
  sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  status: text("status").$type<AttemptStatus>().notNull().default("queued"),
  providerRef: text("provider_ref"),
  referenceAssetIds: jsonb("reference_asset_ids").$type<string[]>().notNull().default([]),
  clipAssetId: uuid("clip_asset_id"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobStatus = "queued" | "running" | "done" | "failed";

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_queue_idx").on(t.status, t.runAt)],
);
