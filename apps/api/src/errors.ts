import type { z } from "zod";

/** Ошибка с кодом из контракта API. Обработчик ошибок превращает её в ответ { error: { code, message, details } }. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Нужно войти заново") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Нет прав") => new AppError(403, "FORBIDDEN", message);
export const rateLimited = (message: string) => new AppError(429, "RATE_LIMITED", message);

/** Проверяет тело запроса по схеме Zod; при ошибке — 422 VALIDATION_ERROR с перечнем полей. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new AppError(422, "VALIDATION_ERROR", "Неверные данные", details);
  }
  return parsed.data;
}
