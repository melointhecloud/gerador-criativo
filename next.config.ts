import type { NextConfig } from "next";

// agentRules desligado: o `next dev` não cria/atualiza AGENTS.md no repositório.
const config: NextConfig = {
  agentRules: false,
  // Cabeçalhos de segurança em todas as rotas. Só frame-ancestors na CSP, de propósito (uma CSP completa pode quebrar o Next/React).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};
export default config;
