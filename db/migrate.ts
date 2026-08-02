import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

interface AppliedMigrationRow {
  name: string;
  checksum: string;
}

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function runMigrations(database: DatabaseSync, migrationsDir: string) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS __schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = database
    .prepare("SELECT name, checksum FROM __schema_migrations")
    .all() as unknown as AppliedMigrationRow[];
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));

  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));

  const recordMigration = database.prepare(`
    INSERT INTO __schema_migrations (name, checksum, applied_at)
    VALUES (?, ?, ?)
  `);
  let appliedCount = 0;

  for (const name of migrationNames) {
    const migrationSql = readFileSync(join(migrationsDir, name), "utf8");
    const migrationChecksum = checksum(migrationSql);
    const existingChecksum = applied.get(name);

    if (existingChecksum) {
      if (existingChecksum !== migrationChecksum) {
        throw new Error(`数据库迁移 ${name} 在应用后被修改，已停止启动。`);
      }
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migrationSql);
      recordMigration.run(name, migrationChecksum, new Date().toISOString());
      database.exec("COMMIT");
      appliedCount += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  database.exec("PRAGMA optimize");
  return appliedCount;
}
