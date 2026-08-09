import { useEffect } from "react";
import { AlertTriangle, Check, ChevronDown, Clock3, Copy, Ellipsis, FileText, Inbox, Pause, Play, RefreshCcw, Search, Trash2, X } from "lucide-react";
import { Button, ProgressBar, SectionTitle } from "../components/ui";
import { downloadTaskResult, getImageTask, hasTauriRuntime } from "../lib/desktop";
import { findDownloadedResult, getProjectPath, saveDownloadedResult, updatePersistedTask } from "../lib/database";
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
  const currentProject = useAppStore((state) => state.currentProject);
  const paused = useAppStore((state) => state.queuePaused);
  const setPaused = useAppStore((state) => state.setQueuePaused);
  const selectedId = useAppStore((state) => state.selectedTaskId);
  const selectTask = useAppStore((state) => state.selectTask);
  const retryTask = useAppStore((state) => state.retryTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const notify = useAppStore((state) => state.notify);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0];

  useEffect(() => {
    if (!hasTauriRuntime()) return;
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
  }, [tasks, updateTask]);

  const retryAndPersist = (id: string) => {
    retryTask(id);
    void updatePersistedTask(id, { status: "queued", progress: 0, error: undefined, elapsed: "00:00:00" });
  };

  return (
    <div className="screen-layout screen-layout--tasks">
      <aside className="context-sidebar task-sidebar">
        <SectionTitle>任务中心</SectionTitle>
        <div className="task-filters">
          <button className="is-active"><Play size={18} /><span>进行中</span><b>{tasks.filter((task) => task.status === "running" || task.status === "analyzing").length}</b></button>
          <button><Clock3 size={18} /><span>等待中</span><b>{tasks.filter((task) => task.status === "queued").length}</b></button>
          <button><Check size={18} /><span>已完成</span><b>{tasks.filter((task) => task.status === "completed").length}</b></button>
          <button><AlertTriangle size={18} /><span>失败</span><b>{tasks.filter((task) => task.status === "failed").length}</b></button>
        </div>
        <div className="project-scopes"><h3>项目范围</h3>{["全部项目", currentProject?.name ?? "未打开项目"].map((name, index) => <button className={index === 0 ? "is-active" : ""} key={name}>{name}</button>)}</div>
      </aside>

      <section className="workspace task-workspace">
        <header className="task-header"><SectionTitle>任务队列</SectionTitle></header>
        <div className="task-toolbar">
          <Button icon={paused ? <Play size={16} /> : <Pause size={16} />} onClick={() => setPaused(!paused)}>{paused ? "全部继续" : "全部暂停"}</Button>
          <Button icon={<Trash2 size={16} />} onClick={() => notify("已清理完成任务的本地记录")}>清理已完成</Button>
          <span />
          <label>并发 <button>2 <ChevronDown size={14} /></button></label>
          <label className="task-search"><Search size={16} /><input placeholder="搜索任务（名称 / 项目）" /></label>
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
          {tasks.map((task, index) => {
            const tone = task.status === "completed" ? "success" : task.status === "failed" ? "danger" : task.status === "queued" ? "local" : "accent";
            return (
              <button key={task.id} className={`task-row ${selectedId === task.id ? "is-selected" : ""} ${task.status === "failed" ? "is-failed" : ""}`} onClick={() => selectTask(task.id)}>
                <div className="task-name"><b>{index + 1}</b>{task.thumbnail ? <img src={task.thumbnail} alt="" /> : <span className="task-file-icon"><FileText size={20} /></span>}<span><strong>{task.title}</strong><small>{task.dimensions ?? "—"}</small></span></div>
                <span>{task.project}</span>
                <span>{task.provider}{task.cost === "本地" ? <em>本地</em> : null}</span>
                <div className="task-progress"><strong className={`tone-${tone}`}>{task.status === "running" || task.status === "analyzing" ? `${task.progress}%` : statusLabels[task.status]}</strong><span>{statusLabels[task.status]}</span><ProgressBar value={task.progress} tone={tone} /></div>
                <span>{task.cost}</span>
                <span>{task.elapsed}</span>
                <span className="task-actions">{task.status === "failed" ? <><i onClick={(event) => { event.stopPropagation(); retryAndPersist(task.id); }}>重试</i><i>查看日志</i></> : task.status === "completed" ? <Check size={18} /> : <Pause size={17} />}<Ellipsis size={17} /></span>
              </button>
            );
          })}
        </div>
        <footer className="task-pagination"><span>共 {tasks.length} 项</span><div><button>‹</button><button className="is-active">1</button><button>›</button><button>20 条/页 <ChevronDown size={13} /></button></div></footer>
      </section>

      <aside className="inspector task-inspector">
        <div className="inspector__header"><span>任务详情</span><X size={17} /></div>
        {!selectedTask ? (
          <div className="task-detail-empty">暂无任务详情</div>
        ) : (
          <>
        <div className="task-detail-summary">{selectedTask.thumbnail ? <img src={selectedTask.thumbnail} alt="" /> : <FileText size={32} />}<div><strong>{selectedTask.title}</strong><span>{selectedTask.project}</span><small>用时：{selectedTask.elapsed}</small></div></div>
        <div className="execution-flow"><h3>执行流程</h3>{[["排队", "10:22:18", true], ["上传素材", "10:22:20", true], ["提交任务", "10:22:22", true], ["轮询结果", "10:23:39", selectedTask.status !== "failed"]].map(([label, time, ok]) => <div key={String(label)} className={ok ? "is-done" : "is-error"}><i>{ok ? <Check size={14} /> : <X size={14} />}</i><span><strong>{label}</strong>{label === "上传素材" ? <small>参考图已随任务提交</small> : null}{label === "轮询结果" && !ok ? <small>{selectedTask.error ?? "API 请求超时"}</small> : null}</span><time>{time}</time></div>)}</div>
        {selectedTask.status === "failed" ? <div className="error-detail"><h3>错误信息</h3><div><AlertTriangle size={17} /><span><strong>{selectedTask.error ?? "请求失败"}</strong><small>请稍后重试，或检查网络与服务状态。</small></span></div></div> : null}
        <div className="retry-policy"><h3>重试策略</h3><p>自动重试：已启用（最多 3 次）</p></div>
        <div className="task-inspector__actions"><Button variant="primary" icon={<RefreshCcw size={16} />} onClick={() => retryAndPersist(selectedTask.id)}>重试任务</Button><Button icon={<Copy size={16} />} onClick={() => notify("诊断信息已复制（脱敏）")}>复制诊断信息</Button></div>
          </>
        )}
      </aside>
    </div>
  );
}
