import type { NextConfig } from "next";

// agentRules desligado: o `next dev` não cria/atualiza AGENTS.md no repositório.
const config: NextConfig = { agentRules: false };
export default config;
