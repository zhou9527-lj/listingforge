import { useEffect, useState } from "react";
import { AlertTriangle, FilePlus2, Folder, FolderOpen, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Button, SectionTitle } from "../components/ui";
import { desktopErrorMessage, hasTauriRuntime } from "../lib/desktop";
import {
  createProjectRecord,
  deleteProjectRecord,
  listProjects,
  renameProjectRecord,
  loadPersistedTasks,
  type ProjectRecord,
} from "../lib/database";
import { useAppStore } from "../store/appStore";

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
};

/** 项目列表查询 + 15 秒超时兜底：打包版出现过该查询挂起导致"正在读取本地项目…"永不消失，超时后转为错误态可重试。 */
const listProjectsWithTimeout = (): Promise<ProjectRecord[]> =>
  Promise.race([
    listProjects(),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("读取项目列表超时，请重试")), 15000);
    }),
  ]);

export function Projects() {
  const notify = useAppStore((state) => state.notify);
  const openProject = useAppStore((state) => state.openProject);
  const hydrateLocalState = useAppStore((state) => state.hydrateLocalState);
  const pendingCreateProject = useAppStore((state) => state.pendingCreateProject);
  const consumeProjectCreator = useAppStore((state) => state.consumeProjectCreator);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);

  // 对话框操作（重命名/删除）后刷新列表；事件处理器内调用，不受 effect 规则限制
  const refresh = async () => {
    if (!hasTauriRuntime()) return;
    try {
      setProjects(await listProjects());
    } catch (error) {
      notify(desktopErrorMessage(error, "读取项目列表失败"));
    }
  };

  // 重试走事件处理器；挂载加载见下方 effect（避免在 effect 内同步 setState）
  const retry = async () => {
    if (!hasTauriRuntime()) return;
    setLoading(true);
    setLoadError(null);
    try {
      setProjects(await listProjectsWithTimeout());
    } catch (error) {
      setLoadError(desktopErrorMessage(error, "读取项目列表失败"));
      notify(desktopErrorMessage(error, "读取项目列表失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await listProjectsWithTimeout();
        if (!cancelled) setProjects(list);
      } catch (error) {
        if (!cancelled) {
          setLoadError(desktopErrorMessage(error, "读取项目列表失败"));
          notify(desktopErrorMessage(error, "读取项目列表失败"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  // 顶栏「新建项目」入口：切到项目管理器并自动打开创建对话框
  useEffect(() => {
    if (!pendingCreateProject) return;
    consumeProjectCreator();
    const timer = window.setTimeout(() => setShowCreate(true), 0);
    return () => window.clearTimeout(timer);
  }, [pendingCreateProject, consumeProjectCreator]);

  const openProjectWithPath = async (project: ProjectRecord) => {
    openProject({ id: project.id, name: project.name, path: project.path });
    hydrateLocalState(await loadPersistedTasks(), null);
    notify(`已打开项目「${project.name}」`);
  };

  return (
    <div className="screen-layout screen-layout--projects">
      <section className="workspace projects-workspace">
        <header className="projects-header">
          <div>
            <SectionTitle>我的项目</SectionTitle>
            <p>项目数据保存在本地，可随时切换；密钥不会进入项目文件。</p>
          </div>
          <Button variant="primary" icon={<FilePlus2 size={16} />} onClick={() => setShowCreate(true)}>新建项目</Button>
        </header>

        {!hasTauriRuntime() ? (
          <div className="empty-state">
            <Folder size={40} strokeWidth={1.4} />
            <h3>项目管理仅桌面版可用</h3>
            <p>浏览器预览不包含本地项目数据库；请在桌面应用中管理项目。</p>
          </div>
        ) : loading ? (
          <div className="empty-state"><p>正在读取本地项目…</p></div>
        ) : loadError ? (
          <div className="empty-state">
            <AlertTriangle size={40} strokeWidth={1.4} />
            <h3>读取项目列表失败</h3>
            <p>{loadError}</p>
            <Button icon={<RefreshCw size={16} />} onClick={() => void retry()}>重试</Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <Folder size={40} strokeWidth={1.4} />
            <h3>创建你的第一个项目</h3>
            <p>每个项目拥有独立的素材、任务、结果、画布与导出记录。</p>
            <Button variant="primary" icon={<FilePlus2 size={16} />} onClick={() => setShowCreate(true)}>新建项目</Button>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <header>
                  <span className="project-card__icon"><FolderOpen size={20} strokeWidth={1.6} /></span>
                  <div><h3>{project.name}</h3><p>{formatTime(project.updatedAt)}</p></div>
                </header>
                <p className="project-card__path" title={project.path}>{project.path}</p>
                <div className="project-card__stats">
                  <span>素材 {project.assetCount}</span>
                  <span>任务 {project.taskCount}</span>
                  <span>{project.platform === "未指定" ? "未设置平台" : project.platform}</span>
                </div>
                <footer>
                  <Button variant="primary" size="sm" onClick={() => void openProjectWithPath(project)}>打开</Button>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setRenameTarget(project)}>重命名</Button>
                  <Button size="sm" icon={<Trash2 size={14} />} onClick={() => setDeleteTarget(project)}>删除</Button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {showCreate ? <CreateProjectDialog onClose={() => setShowCreate(false)} onCreated={(project) => { setShowCreate(false); setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]); void openProjectWithPath(project); }} /> : null}
      {renameTarget ? <RenameProjectDialog project={renameTarget} onClose={() => setRenameTarget(null)} onRenamed={() => { setRenameTarget(null); void refresh(); }} /> : null}
      {deleteTarget ? <DeleteProjectDialog project={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void refresh(); }} /> : null}
    </div>
  );
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: ProjectRecord) => void }) {
  const notify = useAppStore((state) => state.notify);
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickDirectory = async () => {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({ directory: true, defaultPath: parentPath ?? (await appDataDir()) });
      if (typeof chosen === "string") setParentPath(chosen);
    } catch (error) {
      notify(desktopErrorMessage(error, "选择目录失败"));
    }
  };

  const create = async () => {
    if (!name.trim()) {
      notify("请输入项目名称");
      return;
    }
    setBusy(true);
    try {
      if (!parentPath) {
        const { appDataDir } = await import("@tauri-apps/api/path");
        setParentPath(await appDataDir());
      }
      const project = await createProjectRecord(name.trim(), parentPath ?? (await (await import("@tauri-apps/api/path")).appDataDir()));
      if (project) onCreated(project);
    } catch (error) {
      notify(desktopErrorMessage(error, "创建项目失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="新建项目" onClose={onClose}>
      <label className="modal-field"><span>项目名称</span><input value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="例如：便携榨汁杯" /></label>
      <label className="modal-field"><span>保存位置</span><button className="modal-directory" onClick={() => void pickDirectory()}>{parentPath ?? "选择保存目录（默认应用数据目录）"}</button></label>
      <footer className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy} onClick={() => void create()}>{busy ? "创建中…" : "创建并打开"}</Button>
      </footer>
    </Modal>
  );
}

function RenameProjectDialog({ project, onClose, onRenamed }: { project: ProjectRecord; onClose: () => void; onRenamed: () => void }) {
  const notify = useAppStore((state) => state.notify);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    if (!name.trim()) {
      notify("请输入项目名称");
      return;
    }
    setBusy(true);
    try {
      await renameProjectRecord(project.id, name.trim(), project.path);
      notify(`已重命名为「${name.trim()}」`);
      onRenamed();
    } catch (error) {
      notify(desktopErrorMessage(error, "重命名失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`重命名「${project.name}」`} onClose={onClose}>
      <label className="modal-field"><span>项目名称</span><input value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(); }} /></label>
      <footer className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy} onClick={() => void rename()}>{busy ? "保存中…" : "保存"}</Button>
      </footer>
    </Modal>
  );
}

function DeleteProjectDialog({ project, onClose, onDeleted }: { project: ProjectRecord; onClose: () => void; onDeleted: () => void }) {
  const notify = useAppStore((state) => state.notify);
  const [removeDirectory, setRemoveDirectory] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteProjectRecord(project.id, project.path, removeDirectory);
      notify(removeDirectory ? "项目及其目录文件已删除" : "项目记录已删除（目录文件保留）");
      onDeleted();
    } catch (error) {
      notify(desktopErrorMessage(error, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="删除项目" onClose={onClose}>
      <p className="modal-warning">将删除「{project.name}」在 SQLite 中的全部记录（任务、结果、画布、导出）。</p>
      <label className="modal-check"><input type="checkbox" checked={removeDirectory} onChange={(event) => setRemoveDirectory(event.target.checked)} /><span>同时删除磁盘上的项目目录文件（不可恢复）</span></label>
      <footer className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? "删除中…" : "删除项目"}</Button>
      </footer>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="modal-close" aria-label="关闭" onClick={onClose}><X size={16} /></button></header>
        {children}
      </div>
    </div>
  );
}
