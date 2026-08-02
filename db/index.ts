import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrate.ts";
import {
  createSqliteBackup,
  listLocalDatabaseBackups,
  resolveLocalBackupPath,
  type LocalBackupReason,
} from "./本地备份.ts";

export interface OpenLocalDatabaseOptions {
  filePath?: string;
  migrationsDir?: string;
}

const globalDatabase = globalThis as typeof globalThis & {
  aiTavernDatabase?: DatabaseSync;
  aiTavernExitBackupRegistered?: boolean;
};

export function getLocalDataDirectory() {
  const configuredDirectory = process.env.AI_TAVERN_DATA_DIR?.trim();
  if (!configuredDirectory) {
    return join(process.cwd(), "data");
  }

  return isAbsolute(configuredDirectory)
    ? configuredDirectory
    : resolve(process.cwd(), configuredDirectory);
}

export function getLocalDatabasePath() {
  return join(getLocalDataDirectory(), "ai-tavern.sqlite");
}

export function openLocalDatabase(options: OpenLocalDatabaseOptions = {}) {
  const filePath = options.filePath ?? getLocalDatabasePath();
  const configuredMigrationsDirectory =
    process.env.AI_TAVERN_MIGRATIONS_DIR?.trim();
  const migrationsDir =
    options.migrationsDir ??
    (configuredMigrationsDirectory
      ? isAbsolute(configuredMigrationsDirectory)
        ? configuredMigrationsDirectory
        : resolve(process.cwd(), configuredMigrationsDirectory)
      : join(process.cwd(), "drizzle"));
  const hadExistingDatabase =
    filePath !== ":memory:" && existsSync(filePath) && statSync(filePath).size > 0;

  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const database = new DatabaseSync(filePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    if (hadExistingDatabase) {
      createSqliteBackup(database, filePath, "startup");
    }
    const appliedMigrations = runMigrations(database, migrationsDir);
    if (hadExistingDatabase && appliedMigrations > 0) {
      createSqliteBackup(database, filePath, "migration");
    }
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

export function getDb() {
  if (!globalDatabase.aiTavernDatabase) {
    globalDatabase.aiTavernDatabase = openLocalDatabase();
  }
  if (!globalDatabase.aiTavernExitBackupRegistered) {
    globalDatabase.aiTavernExitBackupRegistered = true;
    process.once("exit", () => {
      const database = globalDatabase.aiTavernDatabase;
      if (!database) return;
      try {
        createSqliteBackup(database, getLocalDatabasePath(), "shutdown");
      } catch {
        // 进程退出阶段不能再向玩家报告错误；下次启动仍会建立备份。
      }
    });
  }
  return globalDatabase.aiTavernDatabase;
}

export function closeDefaultDatabase() {
  globalDatabase.aiTavernDatabase?.close();
  delete globalDatabase.aiTavernDatabase;
}

export function listDefaultDatabaseBackups() {
  return listLocalDatabaseBackups(getLocalDatabasePath());
}

export function createDefaultDatabaseBackup(
  reason: LocalBackupReason = "manual",
) {
  return createSqliteBackup(getDb(), getLocalDatabasePath(), reason);
}

export function restoreDefaultDatabaseBackup(fileName: string) {
  const databasePath = getLocalDatabasePath();
  const sourcePath = resolveLocalBackupPath(databasePath, fileName);
  const safetyBackup = createDefaultDatabaseBackup("pre-restore");
  const safetyPath = resolveLocalBackupPath(databasePath, safetyBackup.fileName);
  const stagingPath = `${databasePath}.restore-${randomUUID()}.tmp`;

  closeDefaultDatabase();
  try {
    copyFileSync(sourcePath, stagingPath);
    renameSync(stagingPath, databasePath);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    getDb();
  } catch (error) {
    closeDefaultDatabase();
    rmSync(stagingPath, { force: true });
    copyFileSync(safetyPath, stagingPath);
    renameSync(stagingPath, databasePath);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    getDb();
    throw error;
  }

  return { restoredFileName: fileName, safetyBackup };
}
