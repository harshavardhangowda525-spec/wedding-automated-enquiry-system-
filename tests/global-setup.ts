import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/weddingflow_test";
  if (!/test/.test(url)) throw new Error("Refusing to reset a database whose name does not contain 'test'");
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("drop schema if exists wf cascade; drop schema if exists wf_migrations cascade;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle", migrationsSchema: "wf_migrations" });
  await pool.end();
}
