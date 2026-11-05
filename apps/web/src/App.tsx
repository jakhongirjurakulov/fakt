import { useEffect, useState } from "react";

type Health = { status: string; db: string; storage: string } | { error: string };

/** Заглушка каркаса: показывает, что веб видит API и базу. */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/v1/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth({ error: "API недоступен" }));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>FAKT</h1>
      <p>Foto · Akt · Kontrol · Toʻlov</p>
      <pre>{health ? JSON.stringify(health, null, 2) : "Проверяю API…"}</pre>
    </main>
  );
}
