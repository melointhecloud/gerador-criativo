"use client";
import { useState } from "react";
import { api } from "@/lib/api";

// Barra no topo das páginas autenticadas: apaga o cookie de sessão e volta ao login.
export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div className="topbar">
      <button className="secondary" disabled={loading} onClick={() => void logout()}>
        Sair
      </button>
    </div>
  );
}
