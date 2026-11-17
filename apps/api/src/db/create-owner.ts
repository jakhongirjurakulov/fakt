// Создаёт компанию и её руководителя — первого пользователя, который сможет войти.
// Регистрации в MVP нет: подрядчиков заводим сами.
//   npm run db:create-owner -- "+998 90 123 45 67" "Имя Фамилия" "ООО Название"
import { loadDatabaseUrl } from "../config.js";
import { normalizePhone } from "../phone.js";
import { createDb } from "./index.js";

const [rawPhone, fullName, companyName] = process.argv.slice(2);
const phone = rawPhone ? normalizePhone(rawPhone) : null;

if (!phone || !fullName?.trim() || !companyName?.trim()) {
  console.error('Использование: npm run db:create-owner -- "+998XXXXXXXXX" "Имя Фамилия" "Название компании"');
  process.exit(1);
}

const db = createDb(loadDatabaseUrl());
try {
  const existing = await db.selectFrom("users").select(["id", "role"]).where("phone", "=", phone).executeTakeFirst();
  if (existing) {
    console.log(`Пользователь с номером ${phone} уже есть (роль: ${existing.role}). Ничего не меняю.`);
  } else {
    const owner = await db.transaction().execute(async (trx) => {
      const company = await trx.insertInto("companies").values({ name: companyName.trim() }).returning("id").executeTakeFirstOrThrow();
      return trx
        .insertInto("users")
        .values({ company_id: company.id, phone, full_name: fullName.trim(), role: "owner" })
        .returning(["id", "phone"])
        .executeTakeFirstOrThrow();
    });
    console.log(`Готово: руководитель ${owner.phone} компании «${companyName.trim()}». Теперь можно войти по этому номеру.`);
  }
} finally {
  await db.destroy();
}
