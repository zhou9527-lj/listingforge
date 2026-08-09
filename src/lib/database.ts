import type { LocaleCode, TaskItem, TaskStatus, ThemeMode } from "../types";
import {
  createProjectDirectory,
  deleteProjectDirectory,
  hasTauriRuntime,
  updateProjectManifest,
} from "./desktop";

const DATABASE_URL = "sqlite:listingforge.db";
/** 旧版本单项目模型遗留的固定项目 id；作为多项目模型的初始值兼容旧数据。 */
const LEGACY_PROJECT_ID = "current-project";
let databasePromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

const getDatabase = async () => {
  if (!hasTauriRuntime()) return null;
  if (!databasePromise) {
    databasePromise = import("@tauri-apps/plugin-sql").then(({ default: Database }) => Database.load(DATABASE_URL));
  }
  return databasePromise;
};

/* 当前项目上下文：由项目管理器切换，持久化在 Zustand（跨启动恢复）。 */
let activeProjectId = LEGACY_PROJECT_ID;
export const setActiveProjectId = (id: string) => {
  activeProjectId = id;
};
export const getActiveProjectId = () => activeProjectId;

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  platform: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  taskCount: number;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<ProjectRecord[]>(
    `SELECT p.id, p.name, p.path, p.platform, p.category,
       p.created_at AS createdAt, p.updated_at AS updatedAt,
       (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS assetCount,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount
     FROM projects p ORDER BY p.updated_at DESC`,
  );
}

export async function getProjectRecord(id: string): Promise<ProjectRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<ProjectRecord[]>(
    `SELECT p.id, p.name, p.path, p.platform, p.category,
       p.created_at AS createdAt, p.updated_at AS updatedAt,
       (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS assetCount,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS taskCount
     FROM projects p WHERE p.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/** 通过 Rust 创建目录结构与清单，再把记录写入 SQLite；返回完整记录。 */
export async function createProjectRecord(name: string, parentPath: string): Promise<ProjectRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const root = await createProjectDirectory(parentPath, name, "未指定", "未指定");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await database.execute(
    `INSERT INTO projects (id, name, path, platform, category, created_at, updated_at)
     VALUES (?, ?, ?, '未指定', '未指定', ?, ?)`,
    [id, name, root, now, now],
  );
  return { id, name, path: root, platform: "未指定", category: "未指定", createdAt: now, updatedAt: now, assetCount: 0, taskCount: 0 };
}

/** 顶栏「保存」：刷新当前项目时间戳，使其在项目列表排序靠前。 */
export async function touchProjectRecord(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("UPDATE projects SET updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
}

/** 重命名：SQLite 记录 + project.json 清单同步；清单失败不影响记录。 */
export async function renameProjectRecord(id: string, name: string, path: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  const now = new Date().toISOString();
  await database.execute("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", [name, now, id]);
  await updateProjectManifest(path, name).catch(() => {});
}

/** 删除项目：先按需删除目录（Rust 侧校验含 project.json），再删 SQLite 记录（外键级联清理关联数据）。 */
export async function deleteProjectRecord(id: string, path: string, removeDirectory: boolean): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  if (removeDirectory) {
    await deleteProjectDirectory(path).catch(() => {});
  }
  await database.execute("DELETE FROM projects WHERE id = ?", [id]);
}

/** 解析当前项目的真实目录路径；未打开项目时返回 null。 */
export async function getProjectPath(): Promise<string | null> {
  if (!hasTauriRuntime()) return null;
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<Array<{ path: string }>>(
    "SELECT path FROM projects WHERE id = ? LIMIT 1",
    [activeProjectId],
  );
  return rows[0]?.path ?? null;
}

interface TaskRow {
  id: string;
  provider_task_id: string | null;
  status: string;
  progress: number;
  title: string;
  dimensions: string | null;
  provider: string;
  cost_label: string;
  elapsed: string;
  error_message: string | null;
  result_url: string | null;
}

const taskStatuses = new Set<TaskStatus>(["running", "analyzing", "queued", "local", "completed", "failed"]);
const asTaskStatus = (value: string): TaskStatus => taskStatuses.has(value as TaskStatus) ? value as TaskStatus : "failed";

const rowToTask = (row: TaskRow): TaskItem => ({
  id: row.id,
  providerTaskId: row.provider_task_id ?? undefined,
  title: row.title,
  dimensions: row.dimensions ?? undefined,
  project: "当前项目",
  provider: row.provider,
  status: asTaskStatus(row.status),
  progress: row.progress,
  cost: row.cost_label,
  elapsed: row.elapsed,
  error: row.error_message ?? undefined,
  resultUrl: row.result_url ?? undefined,
});

export async function loadPersistedTasks(): Promise<TaskItem[]> {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.select<TaskRow[]>(
    "SELECT id, provider_task_id, status, progress, title, dimensions, provider, cost_label, elapsed, error_message, result_url FROM tasks WHERE project_id = ? ORDER BY created_at DESC",
    [activeProjectId],
  );
  return rows.map(rowToTask);
}

/** 生成提交时同步当前项目的平台/类目；未打开项目时返回 null（跳过落库）。 */
const ensureActiveProjectMeta = async (platform: string, category: string) => {
  const database = await getDatabase();
  if (!database) return null;
  const projectPath = await getProjectPath();
  if (!projectPath) return null;
  const now = new Date().toISOString();
  await database.execute(
    "UPDATE projects SET platform = ?, category = ?, updated_at = ? WHERE id = ?",
    [platform, category, now, activeProjectId],
  );
  return database;
};

export async function saveGeneratedTasks(tasks: TaskItem[], platform: string, category: string) {
  const database = await ensureActiveProjectMeta(platform, category);
  if (!database) return;
  const now = new Date().toISOString();
  for (const task of tasks) {
    await database.execute(
      `INSERT INTO tasks (
        id, project_id, provider_task_id, status, progress, retry_count, estimated_cost,
        error_message, created_at, updated_at, title, dimensions, provider, cost_label, elapsed, result_url
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_task_id = excluded.provider_task_id, status = excluded.status, progress = excluded.progress,
        error_message = excluded.error_message, updated_at = excluded.updated_at, title = excluded.title,
        dimensions = excluded.dimensions, provider = excluded.provider, cost_label = excluded.cost_label,
        elapsed = excluded.elapsed, result_url = excluded.result_url`,
      [
        task.id, activeProjectId, task.providerTaskId ?? null, task.status, task.progress,
        task.error ?? null, now, now, task.title, task.dimensions ?? null, task.provider,
        task.cost, task.elapsed, task.resultUrl ?? null,
      ],
    );
  }
}

export async function updatePersistedTask(id: string, patch: Partial<TaskItem>) {
  const database = await getDatabase();
  if (!database) return;
  const current = (await database.select<TaskRow[]>(
    "SELECT id, provider_task_id, status, progress, title, dimensions, provider, cost_label, elapsed, error_message, result_url FROM tasks WHERE id = ? LIMIT 1",
    [id],
  ))[0];
  if (!current) return;
  const task = { ...rowToTask(current), ...patch };
  await database.execute(
    `UPDATE tasks SET status = ?, progress = ?, error_message = ?, updated_at = ?,
     title = ?, dimensions = ?, provider = ?, cost_label = ?, elapsed = ?, result_url = ? WHERE id = ?`,
    [task.status, task.progress, task.error ?? null, new Date().toISOString(), task.title, task.dimensions ?? null, task.provider, task.cost, task.elapsed, task.resultUrl ?? null, id],
  );
}

interface UiSettings {
  theme: ThemeMode;
  locale: LocaleCode;
}

export async function loadUiSettings(): Promise<UiSettings | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<Array<{ value_json: string }>>("SELECT value_json FROM settings WHERE key = ? LIMIT 1", ["ui"]);
  if (!rows[0]) return null;
  try {
    const value = JSON.parse(rows[0].value_json) as Partial<UiSettings>;
    if ((value.theme === "dark" || value.theme === "light") && (value.locale === "zh-CN" || value.locale === "en")) return value as UiSettings;
  } catch {
    return null;
  }
  return null;
}

/** 通用设置读写（settings 表，key/value_json），供设置页各 tab 使用。 */
export async function loadSettingJson<T>(key: string): Promise<T | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<Array<{ value_json: string }>>("SELECT value_json FROM settings WHERE key = ? LIMIT 1", [key]);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value_json) as T;
  } catch {
    return null;
  }
}

export async function saveSettingJson(key: string, value: unknown): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

/** 数据与隐私：清空当前项目的画布文档记录。 */
export async function clearProjectCanvasDocuments(): Promise<number> {
  const database = await getDatabase();
  if (!database) return 0;
  const result = await database.execute("DELETE FROM canvas_documents WHERE project_id = ?", [activeProjectId]);
  return result.rowsAffected;
}

/** 数据与隐私：清空当前项目的导出记录。 */
export async function clearProjectExports(): Promise<number> {
  const database = await getDatabase();
  if (!database) return 0;
  const result = await database.execute("DELETE FROM exports WHERE project_id = ?", [activeProjectId]);
  return result.rowsAffected;
}

export async function saveUiSettings(settings: UiSettings) {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ["ui", JSON.stringify(settings), new Date().toISOString()],
  );
}

export interface AssetRecord {
  id: string;
  role: string;
  path: string;
  mime: string;
}

const ROLE_LABELS: Record<string, string> = {
  product: "主图",
  logo: "Logo",
  package: "包装",
  detail: "细节图",
  style: "风格参考",
};

export const assetRoleLabel = (role: string) => ROLE_LABELS[role] ?? role;

export async function listProjectAssets(): Promise<AssetRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<AssetRecord[]>(
    "SELECT id, role, path, mime FROM assets WHERE project_id = ? ORDER BY rowid DESC",
    [activeProjectId],
  );
}

export async function addAssetRecord(role: string, path: string, sha256: string, mime: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    "INSERT INTO assets (id, project_id, role, path, sha256, width, height, mime) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)",
    [crypto.randomUUID(), activeProjectId, role, path, sha256, mime],
  );
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM assets WHERE id = ? AND project_id = ?", [id, activeProjectId]);
}

interface CanvasDocumentRecord {
  document_json: string;
  width: number;
  height: number;
}

export async function saveCanvasDocumentRecord(pageId: string, documentJson: string, width: number, height: number) {
  const database = await getDatabase();
  if (!database) return;
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO canvas_documents (id, project_id, page_id, document_json, width, height, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(project_id, page_id) DO UPDATE SET
       document_json = excluded.document_json, width = excluded.width, height = excluded.height,
       version = canvas_documents.version + 1, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), activeProjectId, pageId, documentJson, width, height, now],
  );
}

interface ResultRow {
  id: string;
  task_id: string;
  task_title: string;
  remote_url: string | null;
  local_path: string | null;
}

export async function findDownloadedResult(taskId: string): Promise<string | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<Array<{ local_path: string }>>(
    "SELECT local_path FROM results WHERE task_id = ? AND local_path IS NOT NULL ORDER BY rowid DESC LIMIT 1",
    [taskId],
  );
  return rows[0]?.local_path ?? null;
}

export async function saveDownloadedResult(taskId: string, remoteUrl: string, localPath: string) {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    `INSERT INTO results (id, task_id, remote_url, local_path, expires_at, quality_score, selected)
     VALUES (?, ?, ?, ?, NULL, NULL, 0)
     ON CONFLICT(id) DO UPDATE SET remote_url = excluded.remote_url, local_path = excluded.local_path`,
    [crypto.randomUUID(), taskId, remoteUrl, localPath],
  );
}

export async function loadPersistedResults(): Promise<ResultRow[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<ResultRow[]>(
    `SELECT r.id, r.task_id, t.title AS task_title, r.remote_url, r.local_path
     FROM results r JOIN tasks t ON t.id = r.task_id
     WHERE t.project_id = ? AND r.local_path IS NOT NULL
     ORDER BY r.rowid DESC`,
    [activeProjectId],
  );
}

export interface ExportRecord {
  id: string;
  format: string;
  targetPath: string;
  checksum: string | null;
  createdAt: string;
}

export async function listExportRecords(): Promise<ExportRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<ExportRecord[]>(
    "SELECT id, format, target_path AS targetPath, checksum, created_at AS createdAt FROM exports WHERE project_id = ? ORDER BY created_at DESC",
    [activeProjectId],
  );
}

export async function addExportRecord(format: string, targetPath: string, checksum: string | null): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    "INSERT INTO exports (id, project_id, format, target_path, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), activeProjectId, format, targetPath, checksum, new Date().toISOString()],
  );
}

export async function deleteExportRecord(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM exports WHERE id = ? AND project_id = ?", [id, activeProjectId]);
}

export async function loadCanvasDocumentRecord(pageId: string): Promise<CanvasDocumentRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<CanvasDocumentRecord[]>(
    "SELECT document_json, width, height FROM canvas_documents WHERE project_id = ? AND page_id = ? LIMIT 1",
    [activeProjectId, pageId],
  );
  return rows[0] ?? null;
}
