import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 60;
export const OTP_TTL_MINUTES = 5;

export type Role = "owner" | "foreman";

export interface AccessClaims {
  userId: string;
  companyId: string;
  role: Role;
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** Короткий токен доступа (15 минут). Ходит в заголовке Authorization: Bearer. */
export async function signAccessToken(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ cid: claims.companyId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** null — если токен подделан, истёк или неверного формата. */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const { sub, cid, role } = payload;
    if (typeof sub !== "string" || typeof cid !== "string" || (role !== "owner" && role !== "foreman")) return null;
    return { userId: sub, companyId: cid, role };
  } catch {
    return null;
  }
}

/** Токен обновления: 32 случайных байта. В cookie — сам токен, в базе — только его SHA-256. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Шестизначный код входа. */
export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Хэш кода с секретом сервера. Кодов всего миллион — простой SHA-256 подобрали бы перебором
 * за секунды, если бы утекла база. С секретом (HMAC) это невозможно без самого секрета.
 */
export const hashOtp = (phone: string, code: string, secret: string) =>
  createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
