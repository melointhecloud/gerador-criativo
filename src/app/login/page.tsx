"use client";
import { useState } from "react";
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
    <main style={{ maxWidth: 360 }}>
      <h1>Gerador de Criativos</h1>
      <form className="card stack" onSubmit={submit}>
        <label>
          Senha do time
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button disabled={loading || !password}>Entrar</button>
      </form>
    </main>
  );
}
