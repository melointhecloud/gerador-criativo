import type { Db } from "@/db/client";
import type { Providers } from "@/providers/types";
import type { Storage } from "@/storage/types";

export type Deps = {
  db: Db;
  storage: Storage;
  providers: Providers;
  config: { maxSceneReferences: number; sceneMaxSeconds: number };
};
