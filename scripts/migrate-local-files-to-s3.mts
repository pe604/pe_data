// One-off: copies files from the old local ./storage folder into the S3 bucket (encrypted), keeping their keys.
// Usage: npx tsx scripts/migrate-local-files-to-s3.mts [--delete-local]
// Each file is uploaded, read back, decrypted and compared (SHA-256) before anything local is removed.
import "dotenv/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { decrypt, encrypt } from "../src/lib/storage/crypto";

const e = process.env as Record<string, string>;
const LOCAL = path.resolve("storage");
const del = process.argv.includes("--delete-local");
const key = Buffer.from(e.STORAGE_ENCRYPTION_KEY, "base64");
if (key.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes base64");
const ns = e.STORAGE_NAMESPACE || "files";
const s3 = new S3Client({
  endpoint: e.AWS_S3_ENDPOINT_URL,
  region: e.AWS_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY },
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const db = new pg.Client({ connectionString: e.DATABASE_URL });
await db.connect();
const rows = (await db.query(`select "storageKey", "sizeBytes" from "File"`)).rows as { storageKey: string; sizeBytes: number }[];
await db.end();

let ok = 0;
let missing = 0;
for (const r of rows) {
  const p = path.join(LOCAL, r.storageKey.slice(0, 2), r.storageKey);
  if (!existsSync(p)) {
    missing++;
    console.log("not on local disk (skipped):", r.storageKey.slice(0, 8));
    continue;
  }
  const plain = readFileSync(p);
  const Key = `${e.AWS_S3_FOLDER}/${ns}/${r.storageKey}`;
  await s3.send(new PutObjectCommand({ Bucket: e.AWS_S3_BUCKET_NAME, Key, Body: encrypt(plain, key), ContentType: "application/octet-stream" }));
  const got = await s3.send(new GetObjectCommand({ Bucket: e.AWS_S3_BUCKET_NAME, Key }));
  const back = decrypt(Buffer.from(await got.Body!.transformToByteArray()), key);
  if (sha(back) !== sha(plain) || back.length !== r.sizeBytes) throw new Error("Verification failed for " + r.storageKey);
  ok++;
  console.log("migrated + verified:", r.storageKey.slice(0, 8), `${(plain.length / 1048576).toFixed(1)} MB`);
}
console.log(`done: ${ok} migrated, ${missing} not found locally, ${rows.length} in DB`);

if (del && ok + missing === rows.length && existsSync(LOCAL)) {
  const leftovers = readdirSync(LOCAL).filter((d) => statSync(path.join(LOCAL, d)).isDirectory()).length;
  rmSync(LOCAL, { recursive: true, force: true });
  console.log(`deleted local storage folder (${leftovers} sub-folders)`);
}
