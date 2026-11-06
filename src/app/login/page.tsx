"use client";
import { useState } from "react";
import { AlertIcon } from "@/components/icons";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { password } });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div className="page page-narrow login">
      <form className="panel framed login-form stack stack-lg" onSubmit={submit} noValidate>
        <div className="stack stack-sm">
          <h1>Entrar</h1>
          <p className="hint">Ferramenta interna do time de criativos.</p>
        </div>
        <div className="field">
          <label htmlFor="senha">Senha do time</label>
          <input
            id="senha"
            aria-label="Senha do time"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "senha-erro senha-ajuda" : "senha-ajuda"}
            autoFocus
          />
          {error && (
            <p id="senha-erro" className="field-error" role="alert">
              <AlertIcon />
              {error}
            </p>
          )}
          <p id="senha-ajuda" className="hint">
            A senha é a mesma para todo o time. Se você não tem a senha, peça a quem administra a ferramenta.
          </p>
        </div>
        <button className="button-block" disabled={loading || !password}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
