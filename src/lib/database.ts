import type { LocaleCode, TaskItem, TaskStatus, ThemeMode } from "../types";
import {
  createProjectDirectory,
  deleteProjectDirectory,
  hasTauriRuntime,
  updateProjectManifest,
} from "./desktop";
import { createId } from "./ids";

const DATABASE_URL = "sqlite:listingforge.db";
/** 旧版本单项目模型遗留的固定项目 id；作为多项目模型的初始值兼容旧数据。 */
const LEGACY_PROJECT_ID = "current-project";
let databasePromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

const getDatabase = async () => {
  const internals = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ : undefined;
  if (!hasTauriRuntime() || typeof internals?.invoke !== "function") return null;
  if (!databasePromise) {
    databasePromise = import("@tauri-apps/plugin-sql").then(async ({ default: Database }) => {
      const database = await Database.load(DATABASE_URL);
      await database.execute("PRAGMA foreign_keys = ON");
      return database;
    }).catch((error) => {
      // 连接建立失败时丢弃缓存，下次调用重新尝试；否则该 Promise 永远保持 rejected 无法恢复
      databasePromise = null;
      throw error;
    });
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

/** 项目列表查询：LEFT JOIN 聚合代替关联子查询，规避打包版中关联子查询执行路径偶发挂起的问题（见开发进度 2026-08-09 第二十二次）。 */
const PROJECT_LIST_SQL = `SELECT p.id, p.name, p.path, p.platform, p.category,
       p.created_at AS createdAt, p.updated_at AS updatedAt,
       COUNT(DISTINCT a.id) AS assetCount,
       COUNT(DISTINCT t.id) AS taskCount
     FROM projects p
     LEFT JOIN assets a ON a.project_id = p.id
     LEFT JOIN tasks t ON t.project_id = p.id
     GROUP BY p.id`;

export async function listProjects(): Promise<ProjectRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<ProjectRecord[]>(`${PROJECT_LIST_SQL} ORDER BY p.updated_at DESC`);
}

export async function getProjectRecord(id: string): Promise<ProjectRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const rows = await database.select<ProjectRecord[]>(`${PROJECT_LIST_SQL} WHERE p.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

/** 通过 Rust 创建目录结构与清单，再把记录写入 SQLite；返回完整记录。 */
export async function createProjectRecord(name: string, parentPath: string): Promise<ProjectRecord | null> {
  const database = await getDatabase();
  if (!database) return null;
  const created = await createProjectDirectory(parentPath, name, "未指定", "未指定");
  const now = new Date().toISOString();
  try {
    await database.execute(
      `INSERT INTO projects (id, name, path, platform, category, created_at, updated_at)
       VALUES (?, ?, ?, '未指定', '未指定', ?, ?)`,
      [created.id, name, created.path, now, now],
    );
  } catch (error) {
    // 目录和 SQLite 记录是一个逻辑事务；写库失败时回滚本次刚创建的空项目目录。
    await deleteProjectDirectory(created.path).catch(() => {});
    throw error;
  }
  return { id: created.id, name, path: created.path, platform: "未指定", category: "未指定", createdAt: now, updatedAt: now, assetCount: 0, taskCount: 0 };
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
    await deleteProjectDirectory(path);
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

/** 任务行批量写入（upsert），供生成提交与局部编辑共用；调用方自行保证项目上下文有效。 */
const insertTaskRows = async (database: import("@tauri-apps/plugin-sql").default, tasks: TaskItem[]) => {
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
};

export async function saveGeneratedTasks(tasks: TaskItem[], platform: string, category: string) {
  const database = await ensureActiveProjectMeta(platform, category);
  if (!database) return;
  await insertTaskRows(database, tasks);
}

/** 单条任务落库（画布局部编辑等非生成流程）；未打开项目或数据库不可用时静默跳过。 */
export async function saveTaskRecord(task: TaskItem): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  const projectPath = await getProjectPath();
  if (!projectPath) return;
  await insertTaskRows(database, [task]);
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

export async function deleteCompletedTasks(): Promise<number> {
  const database = await getDatabase();
  if (!database) return 0;
  const result = await database.execute(
    "DELETE FROM tasks WHERE project_id = ? AND status = 'completed'",
    [activeProjectId],
  );
  return result.rowsAffected;
}

/** 删除时需同步清理的本地结果文件引用 */
export interface ResultFileRef {
  id: string;
  localPath: string | null;
}

/** 删除单个任务：results 由外键 ON DELETE CASCADE 级联清理，返回其关联的本地结果文件供调用方删除磁盘文件。 */
export async function deleteTaskRecord(id: string): Promise<ResultFileRef[]> {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.select<Array<{ id: string; local_path: string | null }>>(
    "SELECT id, local_path FROM results WHERE task_id = ?",
    [id],
  );
  await database.execute("DELETE FROM tasks WHERE id = ? AND project_id = ?", [id, activeProjectId]);
  return rows.map((row) => ({ id: row.id, localPath: row.local_path }));
}

/** 删除若干结果记录（不删除任务），返回其本地文件引用。 */
export async function deleteResultRecords(ids: string[]): Promise<ResultFileRef[]> {
  const database = await getDatabase();
  if (!database) return [];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await database.select<Array<{ id: string; local_path: string | null }>>(
    `SELECT id, local_path FROM results WHERE id IN (${placeholders})`,
    ids,
  );
  await database.execute(`DELETE FROM results WHERE id IN (${placeholders})`, ids);
  return rows.map((row) => ({ id: row.id, localPath: row.local_path }));
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
  canvas: "画布素材",
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
    [createId(), activeProjectId, role, path, sha256, mime],
  );
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM assets WHERE id = ? AND project_id = ?", [id, activeProjectId]);
}

/** 删除某角色下不在 keepPaths 中的素材记录：用户在生成页移除主图/参考图时同步清理，避免下次打开时"删掉的图又出现"。 */
export async function deleteProjectAssetsNotIn(role: string, keepPaths: string[]): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  const rows = await database.select<Array<{ id: string; path: string }>>(
    "SELECT id, path FROM assets WHERE project_id = ? AND role = ?",
    [activeProjectId, role],
  );
  const keep = new Set(keepPaths);
  for (const row of rows) {
    if (!keep.has(row.path)) {
      await database.execute("DELETE FROM assets WHERE id = ?", [row.id]);
    }
  }
}

export interface GlobalAssetRecord {
  id: string;
  name: string;
  role: string;
  path: string;
  mime: string;
  createdAt: string;
  updatedAt: string;
}

export async function listGlobalAssets(): Promise<GlobalAssetRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<GlobalAssetRecord[]>(
    `SELECT id, name, role, path, mime, created_at AS createdAt, updated_at AS updatedAt
     FROM global_assets ORDER BY updated_at DESC`,
  );
}

export async function addGlobalAssetRecord(name: string, role: string, path: string, sha256: string, mime: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO global_assets (id, name, role, path, sha256, mime, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [createId(), name, role, path, sha256, mime, now, now],
  );
}

export async function renameGlobalAssetRecord(id: string, name: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    "UPDATE global_assets SET name = ?, updated_at = ? WHERE id = ?",
    [name, new Date().toISOString(), id],
  );
}

export async function deleteGlobalAssetRecord(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM global_assets WHERE id = ?", [id]);
}

export interface CustomGenerationTypeRecord {
  id: string;
  name: string;
  purpose: string;
  candidateCount: number;
  ratio: "1:1" | "3:4" | "4:3" | "9:16";
  promptRequirements: string;
  referenceAssetIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface CustomGenerationTypeRow {
  id: string;
  name: string;
  purpose: string;
  candidateCount: number;
  ratio: CustomGenerationTypeRecord["ratio"];
  promptRequirements: string;
  referenceAssetIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

const parseStringArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export async function listCustomGenerationTypes(): Promise<CustomGenerationTypeRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.select<CustomGenerationTypeRow[]>(
    `SELECT id, name, purpose, candidate_count AS candidateCount, ratio,
       prompt_requirements AS promptRequirements, reference_asset_ids_json AS referenceAssetIdsJson,
       created_at AS createdAt, updated_at AS updatedAt
     FROM custom_generation_types ORDER BY updated_at DESC`,
  );
  return rows.map((row) => ({ ...row, referenceAssetIds: parseStringArray(row.referenceAssetIdsJson) }));
}

export async function saveCustomGenerationType(input: Omit<CustomGenerationTypeRecord, "createdAt" | "updatedAt">): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO custom_generation_types (
       id, name, purpose, candidate_count, ratio, prompt_requirements,
       reference_asset_ids_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, purpose = excluded.purpose,
       candidate_count = excluded.candidate_count, ratio = excluded.ratio,
       prompt_requirements = excluded.prompt_requirements,
       reference_asset_ids_json = excluded.reference_asset_ids_json, updated_at = excluded.updated_at`,
    [input.id, input.name, input.purpose, input.candidateCount, input.ratio, input.promptRequirements, JSON.stringify(input.referenceAssetIds), now, now],
  );
}

export async function deleteCustomGenerationType(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM custom_generation_types WHERE id = ?", [id]);
}

export type AgentMode = "advisor" | "operator";

export interface AgentConversationRecord {
  id: string;
  mode: AgentMode;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "agent";
  content: string;
  status: "streaming" | "complete" | "stopped" | "failed";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AgentMessageRow extends Omit<AgentMessageRecord, "metadata"> {
  metadataJson: string | null;
}

export async function listAgentConversations(mode?: AgentMode): Promise<AgentConversationRecord[]> {
  const database = await getDatabase();
  if (!database || !activeProjectId) return [];
  const sql = `SELECT id, mode, title, created_at AS createdAt, updated_at AS updatedAt
    FROM agent_conversations WHERE project_id = ?${mode ? " AND mode = ?" : ""} ORDER BY updated_at DESC`;
  return database.select<AgentConversationRecord[]>(sql, mode ? [activeProjectId, mode] : [activeProjectId]);
}

export async function createAgentConversation(mode: AgentMode, title = "新对话"): Promise<AgentConversationRecord> {
  const database = await getDatabase();
  if (!database || !activeProjectId) throw new Error("请先打开一个项目");
  const id = createId();
  const now = new Date().toISOString();
  await database.execute(
    "INSERT INTO agent_conversations (id, project_id, mode, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, activeProjectId, mode, title, now, now],
  );
  return { id, mode, title, createdAt: now, updatedAt: now };
}

export async function renameAgentConversation(id: string, title: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    "UPDATE agent_conversations SET title = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    [title, new Date().toISOString(), id, activeProjectId],
  );
}

export async function deleteAgentConversation(id: string): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute("DELETE FROM agent_conversations WHERE id = ? AND project_id = ?", [id, activeProjectId]);
}

export async function listAgentMessages(conversationId: string): Promise<AgentMessageRecord[]> {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.select<AgentMessageRow[]>(
    `SELECT m.id, m.conversation_id AS conversationId, m.role, m.content, m.status,
       m.metadata_json AS metadataJson, m.created_at AS createdAt
     FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = ? AND c.project_id = ? ORDER BY m.created_at ASC`,
    [conversationId, activeProjectId],
  );
  return rows.map(({ metadataJson, ...row }) => ({
    ...row,
    metadata: metadataJson ? (() => { try { return JSON.parse(metadataJson) as Record<string, unknown>; } catch { return null; } })() : null,
  }));
}

export async function addAgentMessage(
  conversationId: string,
  role: AgentMessageRecord["role"],
  content: string,
  status: AgentMessageRecord["status"] = "complete",
  metadata: Record<string, unknown> | null = null,
): Promise<AgentMessageRecord> {
  const database = await getDatabase();
  if (!database) throw new Error("本地数据库不可用");
  const id = createId();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO agent_messages (id, conversation_id, role, content, status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, role, content, status, metadata ? JSON.stringify(metadata) : null, now],
  );
  await database.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ?", [now, conversationId]);
  return { id, conversationId, role, content, status, metadata, createdAt: now };
}

export async function updateAgentMessage(
  id: string,
  patch: Pick<AgentMessageRecord, "content" | "status"> & { metadata?: Record<string, unknown> | null },
): Promise<void> {
  const database = await getDatabase();
  if (!database) return;
  await database.execute(
    "UPDATE agent_messages SET content = ?, status = ?, metadata_json = ? WHERE id = ?",
    [patch.content, patch.status, patch.metadata ? JSON.stringify(patch.metadata) : null, id],
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
    [createId(), activeProjectId, pageId, documentJson, width, height, now],
  );
}

interface ResultRow {
  id: string;
  task_id: string;
  task_title: string;
  remote_url: string | null;
  local_path: string | null;
  created_at: string;
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
  // 同一任务只保留一条结果记录：先清旧行再插入（task 级幂等，避免轮询重复下载时每轮插一行）
  await database.execute("DELETE FROM results WHERE task_id = ?", [taskId]);
  await database.execute(
    `INSERT INTO results (id, task_id, remote_url, local_path, expires_at, quality_score, selected)
     VALUES (?, ?, ?, ?, NULL, NULL, 0)`,
    [createId(), taskId, remoteUrl, localPath],
  );
}

export async function loadPersistedResults(): Promise<ResultRow[]> {
  const database = await getDatabase();
  if (!database) return [];
  return database.select<ResultRow[]>(
    `SELECT r.id, r.task_id, t.title AS task_title, r.remote_url, r.local_path, t.created_at
     FROM results r JOIN tasks t ON t.id = r.task_id
     WHERE t.project_id = ? AND r.local_path IS NOT NULL
       AND r.rowid = (SELECT MAX(r2.rowid) FROM results r2 WHERE r2.task_id = r.task_id)
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
    [createId(), activeProjectId, format, targetPath, checksum, new Date().toISOString()],
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
