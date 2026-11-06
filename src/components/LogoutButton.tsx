"use client";
import { useState } from "react";
import { api } from "@/lib/api";

// Barra no topo das páginas autenticadas: apaga o cookie de sessão e volta ao login.
export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
      window.location.href = "/login";
    } catch {
      setError("Não foi possível sair. Tente de novo.");
      setLoading(false);
    }
  }

  return (
    <div className="topbar">
      <button className="secondary" disabled={loading} onClick={() => void logout()}>
        Sair
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}
