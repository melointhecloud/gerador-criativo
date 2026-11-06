"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./icons";
import { LogoutButton } from "./LogoutButton";

// Cabeçalho de todas as páginas. No /login só a marca; nas demais (todas exigem sessão, ver src/proxy.ts),
// a navegação e o botão "Sair".
export function AppHeader() {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {isLogin ? (
          <span className="brand">
            <BrandMark />
            <span>Gerador de Criativos</span>
          </span>
        ) : (
          <>
            <Link className="brand" href="/" aria-label="Gerador de Criativos: início">
              <BrandMark />
              <span className="brand-name">Gerador de Criativos</span>
            </Link>
            <nav className="app-nav" aria-label="Principal">
              <ul>
                <li>
                  <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
                    Projetos
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="app-header-actions">
              <LogoutButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
