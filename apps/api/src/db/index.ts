import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { DB } from "./types.js";

export type Db = Kysely<DB>;

// bigint (деньги в сумах) приходит из pg строкой — превращаем в number.
// Безопасно до 9·10^15 сум, это далеко за пределами любой суммы этапа.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Значение bigint вне безопасного диапазона: ${v}`);
  return n;
});
// date (срок исправления) — строкой YYYY-MM-DD: иначе pg сделает Date в поясе сервера и день может съехать.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// numeric (координаты) — тоже number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Время храним и отдаём в UTC, показ в Asia/Tashkent — на клиенте.
  pool.on("connect", (client) => {
    void client.query("SET TIME ZONE 'UTC'");
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export async function pingDb(db: Db): Promise<boolean> {
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
