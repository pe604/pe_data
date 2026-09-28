// Local Postgres for development without Docker or admin rights.
// Usage: npm run db:local   (leave it running; Ctrl+C to stop)
// Connection: postgresql://postgres:postgres@localhost:5433/pipeline
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const databaseDir = ".data/pg";
const fresh = !existsSync(`${databaseDir}/PG_VERSION`);

const pg = new EmbeddedPostgres({
  databaseDir,
  port: 5433,
  user: "postgres",
  password: "postgres",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("pipeline");
console.log("Local Postgres running on port 5433 (database: pipeline). Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
