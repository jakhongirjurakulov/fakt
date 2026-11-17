import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { AppError, parseBody, rateLimited, unauthorized } from "../errors.js";
import { normalizePhone } from "../phone.js";
import type { SmsSender } from "./sms.js";
import {
  OTP_TTL_MINUTES,
  REFRESH_TTL_DAYS,
  hashOtp,
  newOtpCode,
  newRefreshToken,
  sameHash,
  sha256,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from "./tokens.js";

export interface AuthDeps {
  db: Db;
  sms: SmsSender;
  jwtSecret: string;
  /** Secure-флаг cookie. Выключать только для проверки с телефона по http в локальной сети. */
  cookieSecure: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
}

const REFRESH_COOKIE = "fakt_rt";
const OTP_REQUESTS_PER_10_MIN = 3;
const OTP_MAX_ATTEMPTS = 5;
const REUSE_GRACE_MS = 30_000;

const phoneField = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Номер в формате +998XXXXXXXXX" });
    return z.NEVER;
  }
  return phone;
});

const invalidCode = (attemptsLeft?: number) =>
  new AppError(422, "INVALID_CODE", "Неверный или просроченный код", attemptsLeft === undefined ? undefined : { attempts_left: attemptsLeft });

/** preHandler: пускает только с действующим токеном доступа и кладёт его данные в request.auth. */
export function requireAuth(jwtSecret: string) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const claims = token ? await verifyAccessToken(token, jwtSecret) : null;
    if (!claims) throw unauthorized();
    req.auth = claims;
  };
}

export async function authRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { db, sms, jwtSecret } = deps;

  const setRefreshCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(REFRESH_COOKIE, token, {
      path: "/api/v1/auth",
      httpOnly: true,
      sameSite: "strict",
      secure: deps.cookieSecure,
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
    });
  const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });

  async function loadProfile(userId: string) {
    const row = await db
      .selectFrom("users")
      .innerJoin("companies", "companies.id", "users.company_id")
      .select([
        "users.id",
        "users.phone",
        "users.full_name",
        "users.role",
        "users.lang",
        "users.is_active",
        "users.telegram_chat_id",
        "companies.id as company_id",
        "companies.name as company_name",
      ])
      .where("users.id", "=", userId)
      .executeTakeFirst();
    if (!row || !row.is_active) return null;
    return {
      id: row.id,
      phone: row.phone,
      full_name: row.full_name,
      role: row.role,
      lang: row.lang,
      company: { id: row.company_id, name: row.company_name },
      telegram_linked: row.telegram_chat_id !== null,
    };
  }

  async function issueSession(reply: FastifyReply, user: { id: string; role: string; company: { id: string } }, userAgent?: string) {
    const refresh = newRefreshToken();
    await db
      .insertInto("refresh_tokens")
      .values({
        user_id: user.id,
        token_hash: refresh.hash,
        expires_at: sql<Date>`now() + make_interval(days => ${REFRESH_TTL_DAYS})`,
        user_agent: userAgent ?? null,
      })
      .execute();
    setRefreshCookie(reply, refresh.token);
    return signAccessToken({ userId: user.id, companyId: user.company.id, role: user.role as AccessClaims["role"] }, jwtSecret);
  }

  // Запросить код. Отвечает 204 одинаково — есть такой сотрудник или нет, чтобы не раскрывать, чьи номера в базе.
  app.post("/auth/otp/request", async (req, reply) => {
    const { phone } = parseBody(z.object({ phone: phoneField }), req.body);

    const { count } = await db
      .selectFrom("auth_codes")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("phone", "=", phone)
      .where("created_at", ">", sql<Date>`now() - interval '10 minutes'`)
      .executeTakeFirstOrThrow();
    if (Number(count) >= OTP_REQUESTS_PER_10_MIN) throw rateLimited("Слишком часто. Попробуйте через 10 минут");

    const code = newOtpCode();
    await db
      .insertInto("auth_codes")
      .values({
        phone,
        code_hash: hashOtp(phone, code, jwtSecret),
        expires_at: sql<Date>`now() + make_interval(mins => ${OTP_TTL_MINUTES})`,
      })
      .execute();

    const user = await db.selectFrom("users").select("lang").where("phone", "=", phone).where("is_active", "=", true).executeTakeFirst();
    if (user) {
      const text =
        user.lang === "uz" ? `FAKT: kirish kodi ${code}. Hech kimga aytmang.` : `FAKT: код для входа ${code}. Никому не сообщайте.`;
      await sms.send(phone, text, req.log);
    }
    return reply.status(204).send();
  });

  // Проверить код и войти.
  app.post("/auth/otp/verify", async (req, reply) => {
    const { phone, code } = parseBody(
      z.object({ phone: phoneField, code: z.string().regex(/^\d{6}$/, "Код из 6 цифр") }),
      req.body,
    );

    const latest = await db
      .selectFrom("auth_codes")
      .select(["id", "attempts"])
      .where("phone", "=", phone)
      .where("expires_at", ">", sql<Date>`now()`)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!latest) throw invalidCode();

    // Попытка засчитывается до сравнения и атомарно — параллельные запросы не обойдут лимит.
    const counted = await db
      .updateTable("auth_codes")
      .set((eb) => ({ attempts: eb("attempts", "+", 1) }))
      .where("id", "=", latest.id)
      .where("attempts", "<", OTP_MAX_ATTEMPTS)
      .returning(["attempts", "code_hash"])
      .executeTakeFirst();
    if (!counted) throw rateLimited("Слишком много попыток. Запросите новый код");

    if (!sameHash(counted.code_hash, hashOtp(phone, code, jwtSecret))) {
      throw invalidCode(OTP_MAX_ATTEMPTS - counted.attempts);
    }

    const userRow = await db.selectFrom("users").select("id").where("phone", "=", phone).where("is_active", "=", true).executeTakeFirst();
    const user = userRow && (await loadProfile(userRow.id));
    if (!user) throw invalidCode();

    await db.deleteFrom("auth_codes").where("phone", "=", phone).execute();
    const access_token = await issueSession(reply, user, req.headers["user-agent"]);
    return { access_token, user };
  });

  // Новый токен доступа по cookie. Токен обновления при этом заменяется на новый.
  app.post("/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized();

    const stored = await db
      .selectFrom("refresh_tokens")
      .select(["id", "user_id", "revoked_at", "expires_at"])
      .where("token_hash", "=", sha256(token))
      .executeTakeFirst();
    if (!stored) {
      clearRefreshCookie(reply);
      throw unauthorized();
    }
    if (stored.revoked_at) {
      // Только что заменённый токен (до 30 с) — это гонка двух вкладок, а не кража: просто отказываем.
      // Cookie не трогаем: параллельный запрос уже положил туда новый токен.
      if (Date.now() - stored.revoked_at.getTime() < REUSE_GRACE_MS) throw unauthorized();
      clearRefreshCookie(reply);
      // Отозванный токен пришёл снова — его могли украсть. Отзываем все сессии пользователя.
      await db
        .updateTable("refresh_tokens")
        .set({ revoked_at: sql<Date>`now()` })
        .where("user_id", "=", stored.user_id)
        .where("revoked_at", "is", null)
        .execute();
      clearRefreshCookie(reply);
      throw unauthorized();
    }
    const user = stored.expires_at > new Date() ? await loadProfile(stored.user_id) : null;
    if (!user) {
      clearRefreshCookie(reply);
      throw unauthorized();
    }

    const next = newRefreshToken();
    const rotated = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("refresh_tokens")
        .values({
          user_id: user.id,
          token_hash: next.hash,
          expires_at: sql<Date>`now() + make_interval(days => ${REFRESH_TTL_DAYS})`,
          user_agent: req.headers["user-agent"] ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const old = await trx
        .updateTable("refresh_tokens")
        .set({ revoked_at: sql<Date>`now()`, replaced_by: inserted.id })
        .where("id", "=", stored.id)
        .where("revoked_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!old) throw unauthorized(); // параллельный refresh уже заменил токен — откатываем вставку
      return true;
    });
    if (!rotated) throw unauthorized();

    setRefreshCookie(reply, next.token);
    const access_token = await signAccessToken({ userId: user.id, companyId: user.company.id, role: user.role as AccessClaims["role"] }, jwtSecret);
    return { access_token };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      await db
        .updateTable("refresh_tokens")
        .set({ revoked_at: sql<Date>`now()` })
        .where("token_hash", "=", sha256(token))
        .where("revoked_at", "is", null)
        .execute();
    }
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  const auth = requireAuth(jwtSecret);

  app.get("/me", { preHandler: auth }, async (req) => {
    const user = await loadProfile(req.auth!.userId);
    if (!user) throw unauthorized();
    return user;
  });

  app.patch("/me", { preHandler: auth }, async (req) => {
    const patch = parseBody(
      z
        .object({ full_name: z.string().trim().min(1).max(200).optional(), lang: z.enum(["ru", "uz"]).optional() })
        .strict(),
      req.body,
    );
    if (Object.keys(patch).length > 0) {
      await db.updateTable("users").set(patch).where("id", "=", req.auth!.userId).execute();
    }
    const user = await loadProfile(req.auth!.userId);
    if (!user) throw unauthorized();
    return user;
  });
}
