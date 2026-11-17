// Обёртка над fetch для /api/v1.
// Токен доступа живёт только в памяти вкладки; токен обновления — в httpOnly cookie, JS его не видит.
// На 401 один раз пробуем обновить токен и повторяем запрос.

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface User {
  id: string;
  phone: string;
  full_name: string;
  role: "owner" | "foreman";
  lang: "ru" | "uz";
  company: { id: string; name: string };
  telegram_linked: boolean;
}

let accessToken: string | null = null;

async function raw<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "NETWORK", err?.message ?? "Ошибка сети", err?.details);
  }
  return data as T;
}

let refreshing: Promise<boolean> | null = null;

/**
 * Пробует получить новый токен доступа по cookie. false — нужно войти заново.
 * Одновременные вызовы склеиваются в один запрос: иначе второй придёт со старым,
 * уже заменённым токеном, и сервер примет это за кражу.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= raw<{ access_token: string }>("POST", "/auth/refresh")
    .then(({ access_token }) => {
      accessToken = access_token;
      return true;
    })
    .catch(() => {
      accessToken = null;
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && accessToken && (await refreshSession())) {
      return raw<T>(method, path, body);
    }
    throw e;
  }
}

export const api = {
  requestCode: (phone: string) => raw<void>("POST", "/auth/otp/request", { phone }),
  async verifyCode(phone: string, code: string) {
    const res = await raw<{ access_token: string; user: User }>("POST", "/auth/otp/verify", { phone, code });
    accessToken = res.access_token;
    return res.user;
  },
  me: () => call<User>("GET", "/me"),
  updateMe: (patch: Partial<Pick<User, "full_name" | "lang">>) => call<User>("PATCH", "/me", patch),
  async logout() {
    await raw<void>("POST", "/auth/logout").catch(() => undefined);
    accessToken = null;
  },
};
