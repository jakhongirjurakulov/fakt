import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Время храним и отдаём в UTC, показ в Asia/Tashkent — на клиенте.
  pool.on("connect", (client) => {
    void client.query("SET TIME ZONE 'UTC'");
  });
  return pool;
}

export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
