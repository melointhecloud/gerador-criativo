import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page-narrow stack stack-lg">
      <div className="page-head">
        <h1>Página não encontrada</h1>
        <p>O endereço que você abriu não existe ou foi removido.</p>
      </div>
      <div>
        <Link className="button" href="/">
          Ir para os projetos
        </Link>
      </div>
    </div>
  );
}
