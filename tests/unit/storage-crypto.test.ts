import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/storage/crypto";

const key = randomBytes(32);

describe("storage encryption (SPEC §2)", () => {
  it("round-trips", () => {
    const plain = Buffer.from("%PDF-1.4 confidential deck");
    expect(decrypt(encrypt(plain, key), key).equals(plain)).toBe(true);
  });
  it("never stores plaintext and uses a fresh IV each time", () => {
    const plain = Buffer.from("FreshBus revenue 23.6");
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a.includes(plain)).toBe(false);
    expect(a.equals(b)).toBe(false);
  });
  it("rejects a wrong key and tampered data", () => {
    const blob = encrypt(Buffer.from("x".repeat(100)), key);
    expect(() => decrypt(blob, randomBytes(32))).toThrow();
    const tampered = Buffer.from(blob);
    tampered[20] ^= 1;
    expect(() => decrypt(tampered, key)).toThrow();
    expect(() => decrypt(Buffer.from("not ours"), key)).toThrow("storage_bad_format");
  });
});
