import type { LocaleCode, TaskItem, TaskStatus, ThemeMode } from "../types";
import { hasTauriRuntime, resolveDefaultProject } from "./desktop";

const DATABASE_URL = "sqlite:listingforge.db";
const CURRENT_PROJECT_ID = "current-project";
const PLACEHOLDER_PATH = "local://current-project";
let databasePromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

const getDatabase = async () => {
  if (!hasTauriRuntime()) return null;
  if (!databasePromise) {
    databasePromise = import("@tauri-apps/plugin-sql").then(({ default: Database }) => Database.load(DATABASE_URL));
  }
  return databasePromise;
};

/** 解析当前项目真实目录路径；占位路径或缺失时通过 Rust 创建后写入数据库并缓存。 */
let cachedProjectPath: string | null = null;
export async function getProjectPath(): Promise<string | null> {
  if (!hasTauriRuntime()) return null;
  if (cachedProjectPath) return cachedProjectPath;
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<Array<{ path: string }>>(
    "SELECT path FROM projects WHERE id = ? LIMIT 1",
    [CURRENT_PROJECT_ID],
  );
  const stored = rows[0]?.path;
  if (stored && stored !== PLACEHOLDER_PATH) {
    cachedProjectPath = stored;
    return stored;
  }
  const { appDataDir } = await import("@tauri-apps/api/path");
  const parent = await appDataDir();
  const real = await resolveDefaultProject(parent);
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO projects (id, name, path, platform, category, created_at, updated_at)
     VALUES (?, ?, ?, '未指定', '未指定', ?, ?)
     ON CONFLICT(id) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`,
    [CURRENT_PROJECT_ID, "当前项目", real, now, now],
  );
  cachedProjectPath = real;
  return real;
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

export async function loadPersistedTasks() {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.select<TaskRow[]>(
    "SELECT id, provider_task_id, status, progress, title, dimensions, provider, cost_label, elapsed, error_message, result_url FROM tasks ORDER BY created_at DESC",
  );
  return rows.map(rowToTask);
}

const ensureCurrentProject = async (platform: string, category: string) => {
  const database = await getDatabase();
  if (!database) return null;
  const projectPath = await getProjectPath();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO projects (id, name, path, platform, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, category = excluded.category, updated_at = excluded.updated_at`,
    [CURRENT_PROJECT_ID, "当前项目", projectPath ?? PLACEHOLDER_PATH, platform, category, now, now],
  );
  return database;
};

export async function saveGeneratedTasks(tasks: TaskItem[], platform: string, category: string) {
  const database = await ensureCurrentProject(platform, category);
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
        task.id, CURRENT_PROJECT_ID, task.providerTaskId ?? null, task.status, task.progress,
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

export async function saveUiSettings(settings: UiSettings) {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ["ui", JSON.stringify(settings), new Date().toISOString()],
  );
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
    [crypto.randomUUID(), CURRENT_PROJECT_ID, pageId, documentJson, width, height, now],
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
     WHERE r.local_path IS NOT NULL
     ORDER BY r.rowid DESC`,
  );
}

export async function loadCanvasDocumentRecord(pageId: string): Promise<CanvasDocumentRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<CanvasDocumentRecord[]>(
    "SELECT document_json, width, height FROM canvas_documents WHERE project_id = ? AND page_id = ? LIMIT 1",
    [CURRENT_PROJECT_ID, pageId],
  );
  return rows[0] ?? null;
}
