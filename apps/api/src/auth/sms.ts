import type { FastifyBaseLogger } from "fastify";

/** Отправка SMS. В разработке — запись в лог; Eskiz подключим при развёртывании. */
export interface SmsSender {
  send(phone: string, text: string, log: FastifyBaseLogger): Promise<void>;
}

export const logSmsSender: SmsSender = {
  async send(phone, text, log) {
    log.warn({ phone }, `[SMS не отправлено, режим разработки] ${text}`);
  },
};
