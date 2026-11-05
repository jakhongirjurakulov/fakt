import { describe, expect, it } from "vitest";
import { buildApp, type AppDeps } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const healthy: AppDeps = { checkDb: async () => true, checkStorage: async () => true };

describe("GET /api/v1/health", () => {
  it("отвечает 200, когда база и хранилище доступны", async () => {
    const app = buildApp(healthy);
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok", storage: "ok" });
  });

  it("отвечает 503, когда база недоступна", async () => {
    const app = buildApp({ ...healthy, checkDb: async () => false });
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", db: "down", storage: "ok" });
  });

  it("отвечает 503, когда хранилище недоступно", async () => {
    const app = buildApp({ ...healthy, checkStorage: async () => false });
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", db: "ok", storage: "down" });
  });
});

describe("ошибки", () => {
  it("неизвестный путь — 404 в формате контракта", async () => {
    const app = buildApp(healthy);
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Не найдено" } });
  });
});

describe("loadConfig", () => {
  const valid = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    S3_ENDPOINT: "http://localhost:8333",
    S3_ACCESS_KEY: "k",
    S3_SECRET_KEY: "s",
    S3_BUCKET: "b",
  };

  it("подставляет значения по умолчанию", () => {
    const cfg = loadConfig(valid);
    expect(cfg.API_PORT).toBe(3000);
    expect(cfg.LOG_LEVEL).toBe("info");
  });

  it("падает с понятным сообщением без DATABASE_URL", () => {
    const { DATABASE_URL: _, ...rest } = valid;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });
});
