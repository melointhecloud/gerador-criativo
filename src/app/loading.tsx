// Enquanto a página é montada no servidor (lista de projetos, abertura de um projeto).
export default function Loading() {
  return (
    <div className="page" role="status">
      <p className="hint">Carregando…</p>
      <div className="progress-bar loading-bar" aria-hidden="true" />
    </div>
  );
}
