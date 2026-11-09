// Проверка схемы базы и правил, закреплённых в ней.
// Работает с отдельной базой из TEST_DATABASE_URL (в .env) и полностью пересоздаёт её схему.
// Без TEST_DATABASE_URL тесты пропускаются.
import { NO_MIGRATIONS } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/index.js";
import { assertMigrated, createMigrator } from "../src/db/migrator.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("схема базы", () => {
  let db: Db;
  // База пересоздаётся на каждый прогон, поэтому номеров по порядку достаточно.
  let seq = 0;
  const phone = () => `+99890${String(++seq).padStart(7, "0")}`;

  beforeAll(async () => {
    if (url?.endsWith("/fakt")) throw new Error("TEST_DATABASE_URL указывает на рабочую базу — тесты её сотрут");
    db = createDb(url!);
    const migrator = createMigrator(db);
    assertMigrated(await migrator.migrateTo(NO_MIGRATIONS));
    assertMigrated(await migrator.migrateToLatest());
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function seedStage() {
    const company = await db.insertInto("companies").values({ name: "ООО Тест" }).returningAll().executeTakeFirstOrThrow();
    const owner = await db
      .insertInto("users")
      .values({ company_id: company.id, phone: phone(), full_name: "Руководитель", role: "owner" })
      .returningAll()
      .executeTakeFirstOrThrow();
    const customer = await db
      .insertInto("customers")
      .values({ company_id: company.id, name: "Заказчик", contact_name: "Алишер", contact_phone: phone() })
      .returningAll()
      .executeTakeFirstOrThrow();
    const object = await db
      .insertInto("objects")
      .values({ company_id: company.id, customer_id: customer.id, name: "Дом на Чиланзаре" })
      .returningAll()
      .executeTakeFirstOrThrow();
    const stage = await db
      .insertInto("stages")
      .values({ object_id: object.id, position: 1, name: "Штукатурка", amount: 4_500_000_000 })
      .returningAll()
      .executeTakeFirstOrThrow();
    const item = await db
      .insertInto("stage_items")
      .values({ stage_id: stage.id, position: 1, text_ru: "Стены ровные", text_uz: "Devorlar tekis" })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { company, owner, customer, object, stage, item };
  }

  const sha = "a".repeat(64);

  it("миграция откатывается и применяется заново без ошибок", async () => {
    const migrator = createMigrator(db);
    assertMigrated(await migrator.migrateDown());
    assertMigrated(await migrator.migrateToLatest());
  });

  it("ключи — UUID v7, растут по времени создания", async () => {
    const a = await db.insertInto("companies").values({ name: "A" }).returning("id").executeTakeFirstOrThrow();
    await new Promise((r) => setTimeout(r, 5));
    const b = await db.insertInto("companies").values({ name: "B" }).returning("id").executeTakeFirstOrThrow();
    expect(a.id[14]).toBe("7");
    expect(a.id < b.id).toBe(true);
  });

  it("сумма больше 2 млрд сум возвращается числом без потерь", async () => {
    const { stage } = await seedStage();
    expect(stage.amount).toBe(4_500_000_000);
    expect(typeof stage.amount).toBe("number");
  });

  it("телефон принимается только в формате +998XXXXXXXXX", async () => {
    const { company } = await seedStage();
    await expect(
      db.insertInto("users").values({ company_id: company.id, phone: "901234567", full_name: "X", role: "foreman" }).execute(),
    ).rejects.toThrow(/users_phone_check/);
  });

  it("заказчик объекта — только из той же компании", async () => {
    const a = await seedStage();
    const b = await seedStage();
    await expect(
      db.insertInto("objects").values({ company_id: a.company.id, customer_id: b.customer.id, name: "Чужой" }).execute(),
    ).rejects.toThrow(/foreign key/);
  });

  it("объекты и сотрудники не удаляются", async () => {
    const { object, owner } = await seedStage();
    await expect(db.deleteFrom("objects").where("id", "=", object.id).execute()).rejects.toThrow(/NO_DELETE/);
    await expect(db.deleteFrom("users").where("id", "=", owner.id).execute()).rejects.toThrow(/NO_DELETE/);
  });

  it("архивный объект обязан иметь archived_at", async () => {
    const { object } = await seedStage();
    await expect(db.updateTable("objects").set({ status: "archived" }).where("id", "=", object.id).execute()).rejects.toThrow(
      /check/,
    );
    await db.updateTable("objects").set({ status: "archived", archived_at: new Date() }).where("id", "=", object.id).execute();
  });

  it("сумму этапа можно менять только до начала работ", async () => {
    const { stage } = await seedStage();
    await db.updateTable("stages").set({ amount: 5_000_000 }).where("id", "=", stage.id).execute();
    await db.updateTable("stages").set({ status: "in_progress", started_at: new Date() }).where("id", "=", stage.id).execute();
    await expect(db.updateTable("stages").set({ amount: 6_000_000 }).where("id", "=", stage.id).execute()).rejects.toThrow(
      /AMOUNT_LOCKED/,
    );
  });

  it("фото нельзя изменить или удалить, повтор client_id не создаёт дубль", async () => {
    const { owner, item } = await seedStage();
    const photo = {
      client_id: crypto.randomUUID(),
      stage_item_id: item.id,
      uploaded_by: owner.id,
      storage_key: `photos/${crypto.randomUUID()}.jpg`,
      sha256: sha,
      taken_at: new Date(),
      lat: 41.311081,
      lon: 69.240562,
      width: 1600,
      height: 1200,
    };
    const saved = await db.insertInto("photos").values(photo).returningAll().executeTakeFirstOrThrow();
    expect(saved.lat).toBe(41.311081);

    await expect(db.updateTable("photos").set({ width: 1 }).where("id", "=", saved.id).execute()).rejects.toThrow(/IMMUTABLE/);
    await expect(db.deleteFrom("photos").where("id", "=", saved.id).execute()).rejects.toThrow(/IMMUTABLE/);
    await expect(
      db.insertInto("photos").values({ ...photo, storage_key: "photos/other.jpg" }).execute(),
    ).rejects.toThrow(/photos_client_id_key/);
  });

  it("на приёмке у этапа одна отправка, решение по ней окончательное", async () => {
    const { owner, stage } = await seedStage();
    const first = await db
      .insertInto("submissions")
      .values({ stage_id: stage.id, attempt: 1, submitted_by: owner.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    await expect(
      db.insertInto("submissions").values({ stage_id: stage.id, attempt: 2, submitted_by: owner.id }).execute(),
    ).rejects.toThrow(/submissions_one_pending_per_stage/);

    const returned = await db
      .updateTable("submissions")
      .set({ decision: "returned", decided_at: new Date(), return_comment: "Трещина у окна", fix_due_date: "2026-11-20" })
      .where("id", "=", first.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(returned.fix_due_date).toBe("2026-11-20");

    await expect(
      db.updateTable("submissions").set({ decision: "accepted", return_comment: null, fix_due_date: null }).where("id", "=", first.id).execute(),
    ).rejects.toThrow(/DECISION_FINAL/);
  });

  it("номер акта уникален внутри компании", async () => {
    const { company, owner, stage } = await seedStage();
    const act = (submissionId: string) => ({
      company_id: company.id,
      submission_id: submissionId,
      number: "А-1",
      accepted_by_name: "Алишер",
      accepted_by_phone: "+998901112233",
      accepted_at: new Date(),
      pdf_storage_key: `acts/${crypto.randomUUID()}.pdf`,
      pdf_sha256: sha,
    });
    const s1 = await db.insertInto("submissions").values({ stage_id: stage.id, attempt: 1, submitted_by: owner.id, decision: "accepted", decided_at: new Date() }).returning("id").executeTakeFirstOrThrow();
    const s2 = await db.insertInto("submissions").values({ stage_id: stage.id, attempt: 2, submitted_by: owner.id, decision: "accepted", decided_at: new Date() }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("acts").values(act(s1.id)).execute();
    await expect(db.insertInto("acts").values(act(s2.id)).execute()).rejects.toThrow(/acts_company_id_number_key/);
  });
});
