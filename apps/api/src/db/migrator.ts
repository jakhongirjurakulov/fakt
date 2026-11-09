import type { Kysely } from "kysely";
import { Migrator, type MigrationResultSet } from "kysely/migration";
import { migrations } from "./migrations/index.js";

// Миграции подключаются списком, а не чтением папки: так они одинаково работают
// в tsx, в собранном dist и в тестах.
export function createMigrator(db: Kysely<any>): Migrator { // мигратору не важны типы таблиц
  return new Migrator({ db, provider: { getMigrations: async () => migrations } });
}

/** Бросает понятную ошибку, если какая-то миграция не прошла. */
export function assertMigrated({ error, results }: MigrationResultSet): void {
  const failed = results?.find((r) => r.status === "Error");
  if (error || failed) {
    const name = failed ? ` (${failed.migrationName})` : "";
    throw new Error(`Миграция не выполнена${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
