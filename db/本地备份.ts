import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type LocalBackupReason =
  | "startup"
  | "migration"
  | "shutdown"
  | "manual"
  | "pre-restore";

export interface LocalDatabaseBackup {
  fileName: string;
  reason: LocalBackupReason;
  createdAt: string;
  size: number;
}

const BACKUP_FILE_PATTERN =
  /^ai-tavern_(startup|migration|shutdown|manual|pre-restore)_(\d{8}T\d{6}\d{3}Z)_[0-9a-f-]{36}\.sqlite$/;

function backupDirectory(databasePath: string) {
  return join(dirname(databasePath), "backups");
}

function configuredRetention() {
  const parsed = Number.parseInt(process.env.AI_TAVERN_BACKUP_RETENTION ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(50, Math.max(3, parsed)) : 12;
}

function compactTimestamp(date: Date) {
  return date.toISOString().replace(/[-:.]/g, "");
}

function timestampFromFileName(fileName: string) {
  const match = BACKUP_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const timestamp = match[2];
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}.${timestamp.slice(15, 18)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function resolveLocalBackupPath(databasePath: string, fileName: string) {
  if (!BACKUP_FILE_PATTERN.test(fileName)) {
    throw new Error("备份文件名无效。");
  }
  const path = join(backupDirectory(databasePath), fileName);
  if (!statSync(path).isFile()) throw new Error("没有找到指定的本地备份。");
  return path;
}

export function listLocalDatabaseBackups(
  databasePath: string,
): LocalDatabaseBackup[] {
  const directory = backupDirectory(databasePath);
  mkdirSync(directory, { recursive: true });
  return readdirSync(directory)
    .flatMap((fileName) => {
      const match = BACKUP_FILE_PATTERN.exec(fileName);
      const createdAt = timestampFromFileName(fileName);
      if (!match || !createdAt) return [];
      const stats = statSync(join(directory, fileName));
      if (!stats.isFile()) return [];
      return [{
        fileName,
        reason: match[1] as LocalBackupReason,
        createdAt,
        size: stats.size,
      }];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function pruneOldBackups(databasePath: string) {
  const backups = listLocalDatabaseBackups(databasePath);
  for (const backup of backups.slice(configuredRetention())) {
    unlinkSync(join(backupDirectory(databasePath), backup.fileName));
  }
}

export function createSqliteBackup(
  database: DatabaseSync,
  databasePath: string,
  reason: LocalBackupReason,
): LocalDatabaseBackup {
  if (databasePath === ":memory:") {
    throw new Error("内存数据库不能建立本地文件备份。");
  }
  const directory = backupDirectory(databasePath);
  mkdirSync(directory, { recursive: true });
  const now = new Date();
  const fileName = `ai-tavern_${reason}_${compactTimestamp(now)}_${randomUUID()}.sqlite`;
  const filePath = join(directory, fileName);
  database.prepare("VACUUM INTO ?").run(filePath);
  pruneOldBackups(databasePath);
  return {
    fileName,
    reason,
    createdAt: now.toISOString(),
    size: statSync(filePath).size,
  };
}
