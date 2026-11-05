import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

export interface Storage {
  client: S3Client;
  bucket: string;
}

export function createStorage(config: Config): Storage {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: "us-east-1", // SeaweedFS регион не проверяет, но SDK требует значение
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return { client, bucket: config.S3_BUCKET };
}

/** Бакет существует и ключи подходят. */
export async function pingStorage(storage: Storage): Promise<boolean> {
  try {
    await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return true;
  } catch {
    return false;
  }
}
