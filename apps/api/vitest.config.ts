import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Локальный .env (в git не попадает) — оттуда тесты берут TEST_DATABASE_URL.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    // Тесты базы пересоздают схему — запускаем файлы по очереди, чтобы они не мешали друг другу.
    fileParallelism: false,
  },
});
