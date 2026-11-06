"use client";

// Último recurso: o erro aconteceu no layout raiz, então esta página traz o próprio <html> e <body>.
// Não mostra error.message nem digest (podem vazar detalhes do servidor).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480 }}>
        <main>
          <h1>Algo deu errado</h1>
          <p role="alert">Não foi possível carregar a aplicação. Tente de novo; se o problema continuar, avise o time.</p>
          <button onClick={() => reset()}>Tentar de novo</button>
        </main>
      </body>
    </html>
  );
}
