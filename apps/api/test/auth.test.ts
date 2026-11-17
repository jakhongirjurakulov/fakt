// Вход по коду из SMS, токены, refresh, logout и /me — на настоящей тестовой базе.
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { SmsSender } from "../src/auth/sms.js";
import { createDb, type Db } from "../src/db/index.js";
import { assertMigrated, createMigrator } from "../src/db/migrator.js";

const url = process.env.TEST_DATABASE_URL;
const jwtSecret = "test-secret-test-secret-test-secret-123";

describe.skipIf(!url)("вход по коду из SMS", () => {
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  const sent: { phone: string; text: string }[] = [];
  const sms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };

  let seq = 0;
  let phone = "";
  let userId = "";

  beforeAll(async () => {
    if (url?.endsWith("/fakt")) throw new Error("TEST_DATABASE_URL указывает на рабочую базу");
    db = createDb(url!);
    assertMigrated(await createMigrator(db).migrateToLatest());
    app = buildApp({ checkDb: async () => true, checkStorage: async () => true, auth: { db, sms, jwtSecret, cookieSecure: true } });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  // Новый сотрудник на каждый тест — тесты не зависят друг от друга.
  beforeEach(async () => {
    sent.length = 0;
    phone = `+99891${String(Date.now() % 100_000).padStart(5, "0")}${String(++seq).padStart(2, "0")}`;
    const company = await db.insertInto("companies").values({ name: "ООО Тест" }).returning("id").executeTakeFirstOrThrow();
    const user = await db
      .insertInto("users")
      .values({ company_id: company.id, phone, full_name: "Тест Прорабов", role: "foreman" })
      .returning("id")
      .executeTakeFirstOrThrow();
    userId = user.id;
  });

  const post = (path: string, payload?: object, cookie?: string) =>
    app.inject({ method: "POST", url: `/api/v1${path}`, payload, headers: cookie ? { cookie } : {} });

  const lastCode = () => sent.at(-1)?.text.match(/\d{6}/)?.[0] ?? "";

  async function login() {
    await post("/auth/otp/request", { phone });
    const res = await post("/auth/otp/verify", { phone, code: lastCode() });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "fakt_rt")!;
    return { access: res.json().access_token as string, cookie: `fakt_rt=${cookie.value}` };
  }

  it("неверный номер — 422", async () => {
    const res = await post("/auth/otp/request", { phone: "12345" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("код приходит сотруднику; номер можно писать с пробелами", async () => {
    const pretty = `+998 ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9, 11)} ${phone.slice(11)}`;
    const res = await post("/auth/otp/request", { phone: pretty });
    expect(res.statusCode).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe(phone);
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it("на чужой номер отвечает так же, но SMS не отправляет", async () => {
    const res = await post("/auth/otp/request", { phone: "+998770000001" });
    expect(res.statusCode).toBe(204);
    expect(sent).toHaveLength(0);
  });

  it("не больше 3 запросов кода за 10 минут", async () => {
    for (let i = 0; i < 3; i++) expect((await post("/auth/otp/request", { phone })).statusCode).toBe(204);
    const res = await post("/auth/otp/request", { phone });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
  });

  it("5 неверных попыток — дальше код не принимается даже верный", async () => {
    await post("/auth/otp/request", { phone });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    const first = await post("/auth/otp/verify", { phone, code: wrong });
    expect(first.statusCode).toBe(422);
    expect(first.json().error).toMatchObject({ code: "INVALID_CODE", details: { attempts_left: 4 } });
    for (let i = 0; i < 4; i++) await post("/auth/otp/verify", { phone, code: wrong });

    const blocked = await post("/auth/otp/verify", { phone, code });
    expect(blocked.statusCode).toBe(429);
  });

  it("верный код — вход: токен, профиль и httpOnly cookie; код одноразовый", async () => {
    await post("/auth/otp/request", { phone });
    const code = lastCode();
    const res = await post("/auth/otp/verify", { phone, code });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: userId, phone, role: "foreman", telegram_linked: false });

    const cookie = res.cookies.find((c) => c.name === "fakt_rt");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/api/v1/auth" });

    const again = await post("/auth/otp/verify", { phone, code });
    expect(again.statusCode).toBe(422);
  });

  it("GET /me: с токеном — профиль, без токена или с поддельным — 401", async () => {
    const { access } = await login();
    const ok = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${access}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: userId, company: { name: "ООО Тест" } });

    expect((await app.inject({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(401);
    const fake = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${access}x` } });
    expect(fake.statusCode).toBe(401);
    expect(fake.json().error.code).toBe("UNAUTHORIZED");
  });

  it("PATCH /me меняет язык и имя, чужие поля не принимает", async () => {
    const { access } = await login();
    const headers = { authorization: `Bearer ${access}` };
    const ok = await app.inject({ method: "PATCH", url: "/api/v1/me", headers, payload: { lang: "uz" } });
    expect(ok.json().lang).toBe("uz");
    const bad = await app.inject({ method: "PATCH", url: "/api/v1/me", headers, payload: { role: "owner" } });
    expect(bad.statusCode).toBe(422);
  });

  it("refresh выдаёт новый токен и меняет cookie", async () => {
    const { cookie } = await login();
    const res = await post("/auth/refresh", undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBeTypeOf("string");
    const next = res.cookies.find((c) => c.name === "fakt_rt")!;
    expect(`fakt_rt=${next.value}`).not.toBe(cookie);
  });

  it("старый токен сразу после замены — отказ без последствий (гонка вкладок)", async () => {
    const { cookie } = await login();
    const first = await post("/auth/refresh", undefined, cookie);
    const fresh = `fakt_rt=${first.cookies.find((c) => c.name === "fakt_rt")!.value}`;

    expect((await post("/auth/refresh", undefined, cookie)).statusCode).toBe(401);
    expect((await post("/auth/refresh", undefined, fresh)).statusCode).toBe(200);
  });

  it("старый токен пришёл позже — похоже на кражу: отзываются все сессии", async () => {
    const { cookie } = await login();
    const first = await post("/auth/refresh", undefined, cookie);
    const fresh = `fakt_rt=${first.cookies.find((c) => c.name === "fakt_rt")!.value}`;
    await db
      .updateTable("refresh_tokens")
      .set({ revoked_at: sql<Date>`now() - interval '1 minute'` })
      .where("user_id", "=", userId)
      .where("revoked_at", "is not", null)
      .execute();

    expect((await post("/auth/refresh", undefined, cookie)).statusCode).toBe(401);
    expect((await post("/auth/refresh", undefined, fresh)).statusCode).toBe(401);
  });

  it("выход отзывает сессию", async () => {
    const { cookie } = await login();
    expect((await post("/auth/logout", undefined, cookie)).statusCode).toBe(204);
    expect((await post("/auth/refresh", undefined, cookie)).statusCode).toBe(401);
  });

  it("уволенный сотрудник не может ни войти, ни обновить сессию", async () => {
    const { cookie } = await login();
    await db.updateTable("users").set({ is_active: false }).where("id", "=", userId).execute();
    expect((await post("/auth/refresh", undefined, cookie)).statusCode).toBe(401);

    sent.length = 0;
    await post("/auth/otp/request", { phone });
    expect(sent).toHaveLength(0);
  });
});
