"use client";
import { AlertIcon } from "@/components/icons";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page page-narrow stack stack-lg">
      <h1>Algo deu errado</h1>
      <p className="alert" role="alert">
        <AlertIcon />
        <span>Não foi possível carregar esta página. Tente de novo; se o problema continuar, avise o time.</span>
      </p>
      <div>
        <button onClick={() => reset()}>Tentar de novo</button>
      </div>
    </div>
  );
}
