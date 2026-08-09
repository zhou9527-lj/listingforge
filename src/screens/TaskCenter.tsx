import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, Copy, Ellipsis, FileText, Inbox, Pause, Play, RefreshCcw, Search, Trash2, X } from "lucide-react";
import { Button, ProgressBar, SectionTitle } from "../components/ui";
import { deleteProjectResultFile, downloadTaskResult, getImageTask, hasTauriRuntime } from "../lib/desktop";
import { deleteCompletedTasks, deleteTaskRecord, findDownloadedResult, getProjectPath, loadSettingJson, saveDownloadedResult, saveSettingJson, updatePersistedTask } from "../lib/database";
import { mapRemoteTaskStatus } from "../lib/taskPolling";
import { useAppStore } from "../store/appStore";
import type { TaskItem, TaskStatus } from "../types";

const statusLabels: Record<TaskStatus, string> = {
  running: "生成中",
  analyzing: "分析中",
  queued: "等待中",
  local: "本地",
  completed: "已完成",
  failed: "失败",
};

export function TaskCenter() {
  const tasks = useAppStore((state) => state.tasks);
  const paused = useAppStore((state) => state.queuePaused);
  const setPaused = useAppStore((state) => state.setQueuePaused);
  const selectedId = useAppStore((state) => state.selectedTaskId);
  const selectTask = useAppStore((state) => state.selectTask);
  const retryTask = useAppStore((state) => state.retryTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const clearCompletedInStore = useAppStore((state) => state.clearCompletedTasks);
  const removeTaskFromStore = useAppStore((state) => state.removeTask);
  const pruneResultSelection = useAppStore((state) => state.pruneResultSelection);
  const notify = useAppStore((state) => state.notify);
  const [filter, setFilter] = useState<"all" | "active" | "queued" | "completed" | "failed">("all");
  const [query, setQuery] = useState("");
  const [concurrency, setConcurrency] = useState(2);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<TaskItem | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const selectedTask = tasks.find((task) => task.id === selectedId);

  useEffect(() => {
    void loadSettingJson<{ concurrency?: number }>("generation_defaults").then((settings) => {
      if (settings?.concurrency) setConcurrency(settings.concurrency);
    });
  }, []);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === "all" || (filter === "active" ? task.status === "running" || task.status === "analyzing" : task.status === filter);
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return matchesStatus && (!keyword || `${task.title} ${task.project}`.toLocaleLowerCase("zh-CN").includes(keyword));
  }), [filter, query, tasks]);
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const visibleTasks = filteredTasks.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  useEffect(() => {
    if (!hasTauriRuntime() || paused) return;
    const poll = async () => {
      const active = tasks.filter((task) => task.providerTaskId && ["queued", "running"].includes(task.status));
      await Promise.all(active.map(async (task) => {
        try {
          const response = await getImageTask(task.providerTaskId!);
          const data = response.data as { status?: string; progress?: number; cost?: number; error?: { message?: string }; result?: { images?: Array<{ url?: string[] }> } } | undefined;
          if (!data) return;
          const mapped = mapRemoteTaskStatus(data, { status: task.status, progress: task.progress, cost: task.cost });
          const patch: Partial<TaskItem> = mapped;
          const { resultUrl } = mapped;
          if (mapped.status === "completed" && resultUrl && hasTauriRuntime()) {
            const existing = await findDownloadedResult(task.id);
            if (existing) {
              patch.resultUrl = existing;
            } else {
              const projectPath = await getProjectPath();
              if (projectPath) {
                try {
                  const downloaded = await downloadTaskResult(task.providerTaskId!, resultUrl, projectPath);
                  patch.resultUrl = downloaded.localPath;
                  await saveDownloadedResult(task.id, resultUrl, downloaded.localPath);
                } catch (error) {
                  patch.error = error instanceof Error ? error.message : "结果下载失败";
                }
              }
            }
          }
          updateTask(task.id, patch);
          await updatePersistedTask(task.id, patch);
        } catch (error) {
          const patch = { error: error instanceof Error ? error.message : "轮询失败" };
          updateTask(task.id, patch);
          await updatePersistedTask(task.id, patch);
        }
      }));
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(timer);
  }, [paused, tasks, updateTask]);

  const retryAndPersist = (id: string) => {
    retryTask(id);
    void updatePersistedTask(id, { status: "queued", progress: 0, error: undefined, elapsed: "00:00:00" });
  };

  const persistConcurrency = async (value: number) => {
    setConcurrency(value);
    const current = await loadSettingJson<Record<string, unknown>>("generation_defaults") ?? {};
    await saveSettingJson("generation_defaults", { ...current, concurrency: value });
    notify(`并发上限已设为 ${value}`);
  };

  const clearCompleted = async () => {
    try {
      const count = await deleteCompletedTasks();
      clearCompletedInStore();
      setConfirmClear(false);
      notify(`已清理 ${count} 条已完成任务记录`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "清理任务失败");
    }
  };

  /** 删除单条任务：先收集其关联结果文件并删除磁盘文件，再删除任务记录（results 级联清理），同时清理画布选择/收藏状态。 */
  const deleteSingleTask = async () => {
    const task = confirmDeleteTask;
    if (!task) return;
    setDeletingTask(true);
    try {
      const refs = await deleteTaskRecord(task.id);
      if (hasTauriRuntime()) {
        const projectPath = await getProjectPath();
        if (projectPath) {
          await Promise.all(refs.map((ref) => ref.localPath ? deleteProjectResultFile(projectPath, ref.localPath).catch(() => {}) : Promise.resolve()));
        }
      }
      pruneResultSelection(refs.map((ref) => ref.id));
      removeTaskFromStore(task.id);
      setConfirmDeleteTask(null);
      notify(`已删除任务「${task.title}」及其关联结果`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除任务失败");
    } finally {
      setDeletingTask(false);
    }
  };

  const copyDiagnostic = async (task: TaskItem) => {
    const text = JSON.stringify({ id: task.id, title: task.title, provider: task.provider, providerTaskId: task.providerTaskId, status: task.status, progress: task.progress, error: task.error }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      notify("诊断信息已复制（已脱敏）");
    } catch {
      notify("无法访问剪贴板，请重试");
    }
  };

  return (
    <div className="screen-layout screen-layout--tasks">
      <aside className="context-sidebar task-sidebar">
        <SectionTitle>任务中心</SectionTitle>
        <div className="task-filters">
          <button className={filter === "all" ? "is-active" : ""} onClick={() => { setFilter("all"); setPage(1); }}><Inbox size={18} /><span>全部任务</span><b>{tasks.length}</b></button>
          <button className={filter === "active" ? "is-active" : ""} onClick={() => { setFilter("active"); setPage(1); }}><Play size={18} /><span>进行中</span><b>{tasks.filter((task) => task.status === "running" || task.status === "analyzing").length}</b></button>
          <button className={filter === "queued" ? "is-active" : ""} onClick={() => { setFilter("queued"); setPage(1); }}><Clock3 size={18} /><span>等待中</span><b>{tasks.filter((task) => task.status === "queued").length}</b></button>
          <button className={filter === "completed" ? "is-active" : ""} onClick={() => { setFilter("completed"); setPage(1); }}><Check size={18} /><span>已完成</span><b>{tasks.filter((task) => task.status === "completed").length}</b></button>
          <button className={filter === "failed" ? "is-active" : ""} onClick={() => { setFilter("failed"); setPage(1); }}><AlertTriangle size={18} /><span>失败</span><b>{tasks.filter((task) => task.status === "failed").length}</b></button>
        </div>
      </aside>

      <section className="workspace task-workspace">
        <header className="task-header"><SectionTitle>任务队列</SectionTitle></header>
        <div className="task-toolbar">
          <Button icon={paused ? <Play size={16} /> : <Pause size={16} />} onClick={() => setPaused(!paused)}>{paused ? "全部继续" : "全部暂停"}</Button>
          <Button icon={<Trash2 size={16} />} disabled={!tasks.some((task) => task.status === "completed")} onClick={() => setConfirmClear(true)}>清理已完成</Button>
          <span />
          <label>并发 <select aria-label="并发上限" value={concurrency} onChange={(event) => void persistConcurrency(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="task-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索任务（名称 / 项目）" /></label>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state">
            <Inbox size={40} strokeWidth={1.4} />
            <h3>任务队列是空的</h3>
            <p>在生成工作台上传主图并提交方案后，任务会出现在这里。</p>
          </div>
        ) : null}
        <div className="task-table">
          <div className="task-table__head"><span>任务</span><span>项目</span><span>提供方 / 模型</span><span>进度 / 状态</span><span>消耗</span><span>用时</span><span>操作</span></div>
          {visibleTasks.map((task, index) => {
            const tone = task.status === "completed" ? "success" : task.status === "failed" ? "danger" : task.status === "queued" ? "local" : "accent";
            return (
              <div key={task.id} role="button" tabIndex={0} className={`task-row ${selectedId === task.id ? "is-selected" : ""} ${task.status === "failed" ? "is-failed" : ""}`} onClick={() => selectTask(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTask(task.id); } }}>
                <div className="task-name"><b>{(Math.min(page, pageCount) - 1) * pageSize + index + 1}</b>{task.thumbnail ? <img src={task.thumbnail} alt="" /> : <span className="task-file-icon"><FileText size={20} /></span>}<span><strong>{task.title}</strong><small>{task.dimensions ?? "—"}</small></span></div>
                <span>{task.project}</span>
                <span>{task.provider}{task.cost === "本地" ? <em>本地</em> : null}</span>
                <div className="task-progress"><strong className={`tone-${tone}`}>{task.status === "running" || task.status === "analyzing" ? `${task.progress}%` : statusLabels[task.status]}</strong><span>{statusLabels[task.status]}</span><ProgressBar value={task.progress} tone={tone} /></div>
                <span>{task.cost}</span>
                <span>{task.elapsed}</span>
                <span className="task-actions">{task.status === "failed" ? <><i onClick={(event) => { event.stopPropagation(); retryAndPersist(task.id); }}>重试</i><i onClick={(event) => { event.stopPropagation(); selectTask(task.id); notify(task.error ?? "未记录详细错误"); }}>查看错误</i></> : task.status === "completed" ? <Check size={18} /> : <span title="云端任务不支持单项暂停"><Pause size={17} /></span>}<button aria-label="复制任务 ID" title="复制任务 ID" onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(task.providerTaskId ?? task.id).then(() => notify("任务 ID 已复制")); }}><Ellipsis size={17} /></button><button aria-label="删除任务" title="删除任务（含结果文件）" onClick={(event) => { event.stopPropagation(); setConfirmDeleteTask(task); }}><Trash2 size={16} /></button></span>
              </div>
            );
          })}
        </div>
        <footer className="task-pagination"><span>筛选结果 {filteredTasks.length} 项</span><div><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><span className="is-active" aria-label={`第 ${Math.min(page, pageCount)} 页，共 ${pageCount} 页`}>{Math.min(page, pageCount)} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button><select aria-label="每页数量" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条/页</option><option value={20}>20 条/页</option><option value={50}>50 条/页</option></select></div></footer>
      </section>

      <aside className="inspector task-inspector">
        <div className="inspector__header"><span>任务详情</span><button aria-label="关闭任务详情" onClick={() => selectTask("")}><X size={17} /></button></div>
        {!selectedTask ? (
          <div className="task-detail-empty">暂无任务详情</div>
        ) : (
          <>
        <div className="task-detail-summary">{selectedTask.thumbnail ? <img src={selectedTask.thumbnail} alt="" /> : <FileText size={32} />}<div><strong>{selectedTask.title}</strong><span>{selectedTask.project}</span><small>用时：{selectedTask.elapsed}</small></div></div>
        <div className="execution-flow"><h3>执行流程</h3>{[["排队", "10:22:18", true], ["上传素材", "10:22:20", true], ["提交任务", "10:22:22", true], ["轮询结果", "10:23:39", selectedTask.status !== "failed"]].map(([label, time, ok]) => <div key={String(label)} className={ok ? "is-done" : "is-error"}><i>{ok ? <Check size={14} /> : <X size={14} />}</i><span><strong>{label}</strong>{label === "上传素材" ? <small>参考图已随任务提交</small> : null}{label === "轮询结果" && !ok ? <small>{selectedTask.error ?? "API 请求超时"}</small> : null}</span><time>{time}</time></div>)}</div>
        {selectedTask.status === "failed" ? <div className="error-detail"><h3>错误信息</h3><div><AlertTriangle size={17} /><span><strong>{selectedTask.error ?? "请求失败"}</strong><small>请稍后重试，或检查网络与服务状态。</small></span></div></div> : null}
        <div className="retry-policy"><h3>重试策略</h3><p>自动重试：已启用（最多 3 次）</p></div>
        <div className="task-inspector__actions"><Button variant="primary" icon={<RefreshCcw size={16} />} onClick={() => retryAndPersist(selectedTask.id)}>重试任务</Button><Button icon={<Copy size={16} />} onClick={() => void copyDiagnostic(selectedTask)}>复制诊断信息</Button></div>
          </>
        )}
      </aside>
      {confirmDeleteTask ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="删除任务">
            <header><h2>删除任务</h2><button className="modal-close" aria-label="关闭" onClick={() => setConfirmDeleteTask(null)}><X size={16} /></button></header>
            <p className="modal-warning">将删除任务「{confirmDeleteTask.title}」及其关联的结果记录与本地图片文件，不可恢复。确定继续吗？</p>
            <footer className="modal-actions">
              <Button onClick={() => setConfirmDeleteTask(null)}>取消</Button>
              <Button variant="danger" disabled={deletingTask} onClick={() => void deleteSingleTask()}>{deletingTask ? "删除中…" : "确认删除"}</Button>
            </footer>
          </section>
        </div>
      ) : null}
      {confirmClear ? <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="清理已完成任务"><header><h2>清理已完成任务</h2><button className="modal-close" aria-label="关闭" onClick={() => setConfirmClear(false)}><X size={16} /></button></header><p className="modal-warning">将删除当前项目中所有“已完成”任务及其数据库关联结果记录；已导出的文件不受影响。确定继续吗？</p><footer className="modal-actions"><Button onClick={() => setConfirmClear(false)}>取消</Button><Button variant="danger" onClick={() => void clearCompleted()}>确认清理</Button></footer></section></div> : null}
    </div>
  );
}
