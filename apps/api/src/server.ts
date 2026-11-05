import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, pingDb } from "./db.js";
import { createStorage, pingStorage } from "./storage.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const storage = createStorage(config);
const app = buildApp(
  { checkDb: () => pingDb(db), checkStorage: () => pingStorage(storage) },
  { logger: { level: config.LOG_LEVEL } },
);

app.addHook("onClose", async () => {
  await db.end();
  storage.client.destroy();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
