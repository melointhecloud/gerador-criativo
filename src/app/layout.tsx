import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// Baixada no build e servida pelo próprio app (next/font): nenhuma requisição a terceiros em tempo de execução.
// Eixo de largura: títulos condensados, corpo em largura normal (docs/design/direction.md).
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], display: "swap", variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "Gerador de Criativos",
  description: "Ferramenta interna do time para criar vídeos verticais de anúncio (UGC e novelinha) para o TikTok.",
};

export const viewport: Viewport = {
  themeColor: "#1c1d20",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={archivo.variable}>
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        <AppHeader />
        <main id="conteudo" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
