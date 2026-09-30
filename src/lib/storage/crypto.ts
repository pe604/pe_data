import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Client-side encryption for stored files (SPEC §2). AES-256-GCM, authenticated.
// Object layout: "NVE1" | 12-byte IV | ciphertext | 16-byte GCM tag

const MAGIC = Buffer.from("NVE1");
const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

/** Throws if the data was tampered with or the key is wrong. */
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < MAGIC.length + IV_LEN + TAG_LEN || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("storage_bad_format");
  }
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(MAGIC.length + IV_LEN, blob.length - TAG_LEN)), decipher.final()]);
}
