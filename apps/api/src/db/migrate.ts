// Запуск миграций из командной строки:
//   npm run db:migrate   — применить все новые
//   npm run db:rollback  — откатить последнюю
import { loadDatabaseUrl } from "../config.js";
import { createDb } from "./index.js";
import { assertMigrated, createMigrator } from "./migrator.js";

const command = process.argv[2] ?? "latest";
const db = createDb(loadDatabaseUrl());
const migrator = createMigrator(db);

try {
  let resultSet;
  if (command === "latest") resultSet = await migrator.migrateToLatest();
  else if (command === "down") resultSet = await migrator.migrateDown();
  else throw new Error(`Неизвестная команда «${command}». Есть: latest, down`);

  for (const r of resultSet.results ?? []) {
    const arrow = r.direction === "Up" ? "↑" : "↓";
    console.log(`${arrow} ${r.migrationName}: ${r.status}`);
  }
  if (!resultSet.results?.length) console.log("Нечего применять — база в актуальном состоянии");
  assertMigrated(resultSet);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
