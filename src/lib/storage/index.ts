import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { env } from "@/lib/env";
import { decrypt, encrypt } from "./crypto";

/**
 * The only code allowed to store or read files (SPEC §2). Backed by an S3-compatible bucket.
 * - Keys are random UUIDs; original filenames never reach storage.
 * - Every object is encrypted with AES-256-GCM before upload, so the bucket (which may be
 *   publicly readable) only ever holds ciphertext. Files are served through the app's
 *   authorised routes, never via bucket URLs.
 */
export interface StorageDriver {
  put(data: Buffer): Promise<string>;
  /** Web stream of the decrypted bytes. */
  stream(key: string): ReadableStream<Uint8Array>;
  /** Node stream of the decrypted bytes, for zipping. */
  nodeStream(key: string): Readable;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class S3Driver implements StorageDriver {
  private s3 = new S3Client({
    endpoint: env.AWS_S3_ENDPOINT_URL,
    region: env.AWS_REGION,
    forcePathStyle: true, // S3-compatible servers (MinIO etc.) use path-style URLs
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
  });
  private bucket = env.AWS_S3_BUCKET_NAME;
  private key = Buffer.from(env.STORAGE_ENCRYPTION_KEY, "base64");

  private objectKey(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return `${env.AWS_S3_FOLDER}/${env.STORAGE_NAMESPACE}/${key}`;
  }

  async put(data: Buffer) {
    const key = randomUUID();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: encrypt(data, this.key),
        ContentType: "application/octet-stream",
      }),
    );
    return key;
  }

  async read(key: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    if (!res.Body) throw new Error("storage_empty");
    return decrypt(Buffer.from(await res.Body.transformToByteArray()), this.key);
  }

  stream(key: string) {
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          controller.enqueue(new Uint8Array(await this.read(key)));
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
  }

  nodeStream(key: string) {
    const read = () => this.read(key);
    return Readable.from(
      (async function* () {
        yield await read();
      })(),
    );
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }

  async exists(key: string) {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return true;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  driver ??= new S3Driver();
  return driver;
}

export { withTempDir } from "./tmp";
