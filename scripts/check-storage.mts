// Reads every stored file through the app's StorageDriver and checks it decrypts to the recorded size.
// Usage: npx tsx --conditions=react-server scripts/check-storage.mts
import "dotenv/config";
import pg from "pg";
import { storage } from "../src/lib/storage";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(`select "storageKey", "sizeBytes", mime from "File"`);
await db.end();
let ok = 0;
for (const r of rows as { storageKey: string; sizeBytes: number; mime: string }[]) {
  const buf = await storage().read(r.storageKey);
  const pdfOk = r.mime !== "application/pdf" || buf.subarray(0, 5).toString() === "%PDF-";
  if (buf.length !== r.sizeBytes || !pdfOk) throw new Error("Mismatch for " + r.storageKey.slice(0, 8));
  ok++;
}
console.log(`storage OK: ${ok}/${rows.length} files read and decrypted`);
