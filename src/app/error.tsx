"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 480 }}>
      <h1>Algo deu errado</h1>
      <p className="error" role="alert">
        Não foi possível carregar esta página. Tente de novo; se o problema continuar, avise o time.
      </p>
      <button onClick={() => reset()}>Tentar de novo</button>
    </main>
  );
}
