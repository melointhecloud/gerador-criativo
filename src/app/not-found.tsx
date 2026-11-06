import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 480 }}>
      <h1>Página não encontrada</h1>
      <p className="muted">O endereço que você abriu não existe ou foi removido.</p>
      <Link className="button" href="/">
        Ir para o início
      </Link>
    </main>
  );
}
