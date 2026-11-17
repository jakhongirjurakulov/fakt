import { sql, type Kysely } from "kysely";

// Токены обновления: позволяют прорабу не вводить код каждые 15 минут (живут 60 дней)
// и при этом выход из аккаунта действительно отзывает доступ.
// Сам токен лежит только в httpOnly cookie у пользователя, в базе — его SHA-256.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens, -- при обновлении старый токен указывает на новый
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE refresh_tokens`.execute(db);
}
