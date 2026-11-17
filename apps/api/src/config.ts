import { z } from "zod";

const databaseUrl = z.string().url();

const schema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: databaseUrl,
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Подписывает токены доступа и хэши кодов. Длинная случайная строка, своя на каждой машине.
  JWT_SECRET: z.string().min(32, "минимум 32 символа"),
  // false — только чтобы проверить вход с телефона по http в локальной сети.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema>;

function fail(issues: z.core.$ZodIssue[]): never {
  const problems = issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Неверные настройки окружения:\n${problems}\nЗадайте их в файле .env в корне проекта (список — в README)`);
}

/** Читает настройки из окружения и падает сразу, если чего-то не хватает. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) fail(parsed.error.issues);
  return parsed.data;
}

/** Только адрес базы — для миграций, которым не нужно хранилище. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = z.object({ DATABASE_URL: databaseUrl }).safeParse(env);
  if (!parsed.success) fail(parsed.error.issues);
  return parsed.data.DATABASE_URL;
}
