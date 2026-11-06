// URLs sempre relativas (mesma origem): a API recusa requisições de outra origem e usa o cookie de sessão.
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const hasBody = init.body !== undefined || init.form !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  // Sessão expirada: volta ao login (exceto na própria tela de login, onde 401 = senha incorreta).
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}
