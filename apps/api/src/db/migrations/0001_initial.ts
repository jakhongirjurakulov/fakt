import { sql, type Kysely } from "kysely";

// Первая схема базы — по странице «Модель данных» в Notion (проверено аналитиком 3.11.2026).
// Бизнес-правила, которые нельзя нарушить ни при каком баге в коде, закреплены прямо в базе:
// проверками (CHECK), уникальностью и триггерами. Остальные правила — в коде API.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(String.raw`
-- ───────────── Служебные функции ─────────────

-- UUID v7: сортируется по времени создания. В PostgreSQL 17 встроенной функции нет.
CREATE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
  ts bytea := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  b  bytea := uuid_send(gen_random_uuid());
BEGIN
  b := overlay(b PLACING ts FROM 1 FOR 6);
  b := set_byte(b, 6, (b'0111' || get_byte(b, 6)::bit(4))::bit(8)::int);
  RETURN encode(b, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Доказательства (фото, снимки отправок, акты) нельзя ни менять, ни удалять.
CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: записи в % нельзя изменять или удалять', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

-- Объекты и сотрудники не удаляются: только архив или is_active = false.
CREATE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'NO_DELETE: записи в % не удаляются', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

-- Правило 8: сумму этапа можно менять только в статусе todo.
CREATE FUNCTION stage_amount_lock() RETURNS trigger AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount AND OLD.status <> 'todo' THEN
    RAISE EXCEPTION 'AMOUNT_LOCKED: сумма этапа зафиксирована после начала работ'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Правило 3: решение по отправке принимается один раз и не меняется.
CREATE FUNCTION submission_decision_once() RETURNS trigger AS $$
BEGIN
  IF OLD.decision <> 'pending' AND (NEW.decision, NEW.decided_at, NEW.return_comment, NEW.fix_due_date)
     IS DISTINCT FROM (OLD.decision, OLD.decided_at, OLD.return_comment, OLD.fix_due_date) THEN
    RAISE EXCEPTION 'DECISION_FINAL: решение по отправке уже принято'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ───────────── Компания и люди ─────────────

CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name         text NOT NULL CHECK (btrim(name) <> ''),
  inn          text,
  default_lang text NOT NULL DEFAULT 'ru' CHECK (default_lang IN ('ru', 'uz')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id       uuid NOT NULL REFERENCES companies,
  phone            text NOT NULL UNIQUE CHECK (phone ~ '^\+998[0-9]{9}$'),
  full_name        text NOT NULL CHECK (btrim(full_name) <> ''),
  role             text NOT NULL CHECK (role IN ('owner', 'foreman')),
  telegram_chat_id bigint UNIQUE,
  lang             text NOT NULL DEFAULT 'ru' CHECK (lang IN ('ru', 'uz')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_company_id_idx ON users (company_id);

CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id       uuid NOT NULL REFERENCES companies,
  name             text NOT NULL CHECK (btrim(name) <> ''),
  contact_name     text NOT NULL CHECK (btrim(contact_name) <> ''),
  contact_phone    text NOT NULL CHECK (contact_phone ~ '^\+998[0-9]{9}$'),
  telegram_chat_id bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE INDEX customers_company_id_idx ON customers (company_id);

-- ───────────── Объекты и этапы ─────────────

CREATE TABLE objects (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id  uuid NOT NULL REFERENCES companies,
  customer_id uuid NOT NULL,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  address     text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- заказчик объекта — обязательно из той же компании
  FOREIGN KEY (customer_id, company_id) REFERENCES customers (id, company_id),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX objects_company_id_idx ON objects (company_id);
CREATE INDEX objects_customer_id_idx ON objects (customer_id);

CREATE TABLE object_members (
  object_id  uuid NOT NULL REFERENCES objects,
  user_id    uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_id, user_id)
);
CREATE INDEX object_members_user_id_idx ON object_members (user_id);

CREATE TABLE checklist_templates (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id uuid REFERENCES companies, -- NULL — системный шаблон для всех
  name       text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_templates_company_id_idx ON checklist_templates (company_id);

CREATE TABLE checklist_template_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  template_id uuid NOT NULL REFERENCES checklist_templates ON DELETE CASCADE,
  position    int NOT NULL CHECK (position > 0),
  text_ru     text NOT NULL CHECK (btrim(text_ru) <> ''),
  text_uz     text NOT NULL CHECK (btrim(text_uz) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE stages (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  object_id      uuid NOT NULL REFERENCES objects,
  position       int NOT NULL CHECK (position > 0),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  amount         bigint NOT NULL CHECK (amount >= 0), -- сумы, без дробной части
  status         text NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo', 'in_progress', 'in_review', 'returned', 'accepted', 'paid')),
  started_at     timestamptz,
  accepted_at    timestamptz,
  paid_at        timestamptz,
  paid_marked_by uuid REFERENCES users,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- порядок этапов можно менять местами в одной транзакции
  UNIQUE (object_id, position) DEFERRABLE INITIALLY DEFERRED,
  CHECK (status = 'todo' OR started_at IS NOT NULL),
  CHECK (status NOT IN ('accepted', 'paid') OR accepted_at IS NOT NULL),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL AND paid_marked_by IS NOT NULL))
);

CREATE TABLE stage_items (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  stage_id   uuid NOT NULL REFERENCES stages,
  position   int NOT NULL CHECK (position > 0),
  text_ru    text NOT NULL CHECK (btrim(text_ru) <> ''),
  text_uz    text NOT NULL CHECK (btrim(text_uz) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- ───────────── Съёмка ─────────────

CREATE TABLE photos (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  client_id      uuid NOT NULL UNIQUE, -- из телефона: повтор из офлайн-очереди не создаёт дубль
  stage_item_id  uuid NOT NULL REFERENCES stage_items,
  uploaded_by    uuid NOT NULL REFERENCES users,
  storage_key    text NOT NULL UNIQUE,
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  taken_at       timestamptz NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  lat            numeric(9, 6) CHECK (lat BETWEEN -90 AND 90),
  lon            numeric(9, 6) CHECK (lon BETWEEN -180 AND 180),
  gps_accuracy_m int CHECK (gps_accuracy_m >= 0),
  width          int NOT NULL CHECK (width > 0),
  height         int NOT NULL CHECK (height > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((lat IS NULL) = (lon IS NULL))
);
-- «актуальный снимок пункта» = последний загруженный
CREATE INDEX photos_stage_item_latest_idx ON photos (stage_item_id, uploaded_at DESC);

-- ───────────── Приёмка ─────────────

CREATE TABLE submissions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  client_id      uuid UNIQUE, -- идемпотентность отправки из офлайн-очереди
  stage_id       uuid NOT NULL REFERENCES stages,
  attempt        int NOT NULL CHECK (attempt > 0),
  submitted_by   uuid NOT NULL REFERENCES users,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  decision       text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'accepted', 'returned')),
  decided_at     timestamptz,
  return_comment text,
  fix_due_date   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, attempt),
  CHECK ((decision = 'pending') = (decided_at IS NULL)),
  CHECK (decision = 'returned' OR (return_comment IS NULL AND fix_due_date IS NULL))
);
-- на приёмке у этапа может быть только одна отправка
CREATE UNIQUE INDEX submissions_one_pending_per_stage ON submissions (stage_id) WHERE decision = 'pending';

CREATE TABLE submission_photos (
  submission_id uuid NOT NULL REFERENCES submissions,
  stage_item_id uuid NOT NULL REFERENCES stage_items,
  photo_id      uuid NOT NULL REFERENCES photos,
  PRIMARY KEY (submission_id, stage_item_id)
);

CREATE TABLE remarks (
  submission_id uuid NOT NULL REFERENCES submissions,
  stage_item_id uuid NOT NULL REFERENCES stage_items,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, stage_item_id)
);

CREATE TABLE review_links (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  submission_id   uuid NOT NULL UNIQUE REFERENCES submissions,
  token_hash      text NOT NULL UNIQUE, -- сам токен есть только в ссылке
  expires_at      timestamptz NOT NULL,
  first_opened_at timestamptz,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE acts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id        uuid NOT NULL REFERENCES companies, -- нужен для уникальности номера в компании
  submission_id     uuid NOT NULL UNIQUE REFERENCES submissions,
  number            text NOT NULL CHECK (btrim(number) <> ''),
  accepted_by_name  text NOT NULL,
  accepted_by_phone text NOT NULL,
  accepted_at       timestamptz NOT NULL,
  client_ip         text,
  user_agent        text,
  pdf_storage_key   text NOT NULL UNIQUE,
  pdf_sha256        text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- ───────────── Служебные ─────────────

CREATE TABLE auth_codes (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone      text NOT NULL CHECK (phone ~ '^\+998[0-9]{9}$'),
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_codes_phone_idx ON auth_codes (phone, created_at DESC);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  type       text NOT NULL,
  recipient  text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('telegram', 'sms')),
  related_id uuid,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  sent_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_queue_idx ON notifications (created_at) WHERE status = 'queued';

-- ───────────── Триггеры ─────────────

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER objects_updated_at BEFORE UPDATE ON objects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER checklist_templates_updated_at BEFORE UPDATE ON checklist_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER stages_updated_at BEFORE UPDATE ON stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_no_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER objects_no_delete BEFORE DELETE ON objects FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TRIGGER photos_immutable BEFORE UPDATE OR DELETE ON photos FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER submission_photos_immutable BEFORE UPDATE OR DELETE ON submission_photos FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER acts_immutable BEFORE UPDATE OR DELETE ON acts FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER stages_amount_lock BEFORE UPDATE OF amount ON stages FOR EACH ROW EXECUTE FUNCTION stage_amount_lock();
CREATE TRIGGER submissions_decision_once BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION submission_decision_once();
`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
DROP TABLE notifications, auth_codes, acts, review_links, remarks, submission_photos, submissions,
  photos, stage_items, stages, checklist_template_items, checklist_templates, object_members,
  objects, customers, users, companies;
DROP FUNCTION submission_decision_once(), stage_amount_lock(), forbid_delete(), forbid_change(),
  set_updated_at(), uuid_generate_v7();
`).execute(db);
}
