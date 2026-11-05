import Fastify, { type FastifyServerOptions } from "fastify";

export interface AppDeps {
  /** Проверка базы. Передаётся снаружи, чтобы приложение можно было тестировать без PostgreSQL. */
  checkDb: () => Promise<boolean>;
  /** Проверка S3-хранилища: бакет на месте и ключи подходят. */
  checkStorage: () => Promise<boolean>;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  // Единый формат ошибки из контракта API.
  app.setErrorHandler<Error & { statusCode?: number; validation?: unknown }>((err, req, reply) => {
    if (err.validation) {
      return reply.status(422).send({
        error: { code: "VALIDATION_ERROR", message: err.message, details: err.validation },
      } satisfies ApiError);
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    return reply.status(status).send({
      error: { code: status === 500 ? "INTERNAL" : "BAD_REQUEST", message: status === 500 ? "Внутренняя ошибка" : err.message },
    } satisfies ApiError);
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Не найдено" } } satisfies ApiError),
  );

  app.register(
    async (v1) => {
      v1.get("/health", async (_req, reply) => {
        const [db, storage] = await Promise.all([deps.checkDb(), deps.checkStorage()]);
        const ok = db && storage;
        return reply.status(ok ? 200 : 503).send({
          status: ok ? "ok" : "degraded",
          db: db ? "ok" : "down",
          storage: storage ? "ok" : "down",
        });
      });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
