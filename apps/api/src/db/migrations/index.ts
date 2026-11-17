import type { Migration } from "kysely/migration";
import * as m0001 from "./0001_initial.js";
import * as m0002 from "./0002_refresh_tokens.js";

// Новые миграции добавляются сюда. Имя задаёт порядок выполнения — не менять после слияния в main.
export const migrations: Record<string, Migration> = {
  "0001_initial": m0001,
  "0002_refresh_tokens": m0002,
};
