import { approveCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => approveCharacter(deps.db, params.id));
