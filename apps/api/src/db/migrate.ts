/**
 * Runner de migrations idempotente.
 *   pnpm db:migrate         aplica as pendentes (cada uma numa transação)
 *   pnpm db:migrate status  lista aplicadas/pendentes
 *   pnpm db:seed            seed de dev (recusa em produção)
 *
 * Bancos criados antes do runner (as 4 primeiras migrations rodadas na mão com psql)
 * são detectados pela tabela `users` e as 4 são registradas como feitas, sem rodar de novo.
 */
import pg from "pg";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASELINE = ["001_init.sql", "002_auth_extras.sql", "002_dm_attachments.sql", "003_member_moderation.sql"];

const here = dirname(fileURLToPath(import.meta.url));
// Via tsx: src/db. Compilado: dist/db -> os .sql continuam em src/db.
const sqlDir = existsSync(join(here, "migrations")) ? here : join(here, "..", "..", "src", "db");
const migrationsDir = join(sqlDir, "migrations");

const url = process.env.DATABASE_URL ?? "postgres://vekrom:vekrom@localhost:5432/vekrom";
const cmd = process.argv[2] ?? "up";

const client = new pg.Client({ connectionString: url, application_name: "vekrom-migrate" });
await client.connect();

try {
  if (cmd === "seed") {
    if (process.env.NODE_ENV === "production") throw new Error("db:seed é só para desenvolvimento (NODE_ENV=production)");
    await client.query(await readFile(join(sqlDir, "seed.sql"), "utf8"));
    console.log("[seed] ok — alice@example.com / bob@example.com, senha password123");
  } else {
    // Lock para dois deploys simultâneos não aplicarem a mesma migration.
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

    const applied = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    if (applied.size === 0) {
      const legacy = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS has");
      if (legacy.rows[0].has) {
        for (const name of BASELINE) {
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
          applied.add(name);
        }
        console.log(`[migrate] banco existente: ${BASELINE.length} migrations registradas como aplicadas`);
      }
    }

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (cmd === "status") {
      for (const f of files) console.log(`${applied.has(f) ? "[x]" : "[ ]"} ${f}`);
    } else {
      for (const f of pending) {
        const sql = await readFile(join(migrationsDir, f), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
          await client.query("COMMIT");
          console.log(`[migrate] aplicada ${f}`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`${f}: ${(err as Error).message}`);
        }
      }
      if (pending.length === 0) console.log("[migrate] nada pendente");
    }
  }
} catch (err) {
  console.error("[migrate] ERRO:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
