import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { ApiSettings } from "./screens/ApiSettings";
import { CanvasEditor } from "./screens/CanvasEditor";
import { ExportCenter } from "./screens/ExportCenter";
import { GenerationWorkbench } from "./screens/GenerationWorkbench";
import { Materials } from "./screens/Materials";
import { Projects } from "./screens/Projects";
import { ResultsReview } from "./screens/ResultsReview";
import { TaskCenter } from "./screens/TaskCenter";
import { hasTauriRuntime } from "./lib/desktop";
import { getProjectRecord, listProjects, loadPersistedTasks, loadUiSettings, saveUiSettings, setActiveProjectId } from "./lib/database";
import { useAppStore } from "./store/appStore";

function CurrentScreen() {
  const screen = useAppStore((state) => state.screen);
  if (screen === "projects") return <Projects />;
  if (screen === "materials") return <Materials />;
  if (screen === "results") return <ResultsReview />;
  if (screen === "canvas") return <CanvasEditor />;
  if (screen === "tasks") return <TaskCenter />;
  if (screen === "settings") return <ApiSettings />;
  if (screen === "exports") return <ExportCenter />;
  return <GenerationWorkbench />;
}

export default function App() {
  const toast = useAppStore((state) => state.toast);
  const clearToast = useAppStore((state) => state.clearToast);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    void (async () => {
      try {
        // 先恢复当前项目（持久化优先；旧版本遗留项目自动打开），再按项目加载数据
        const projects = await listProjects();
        const persisted = useAppStore.getState().currentProject;
        let restored = persisted ? await getProjectRecord(persisted.id) : null;
        if (!restored) {
          const legacy = projects.find((p) => p.id === "current-project");
          restored = legacy ?? null;
        }
        if (restored) {
          setActiveProjectId(restored.id);
          useAppStore.getState().openProject({ id: restored.id, name: restored.name, path: restored.path });
        }
        const [tasks, settings] = await Promise.all([loadPersistedTasks(), loadUiSettings()]);
        useAppStore.getState().hydrateLocalState(tasks, settings);
      } catch (error) {
        useAppStore.getState().notify(error instanceof Error ? error.message : "读取本地数据库失败");
      }
    })();

    return useAppStore.subscribe((state, previous) => {
      if (state.theme !== previous.theme || state.locale !== previous.locale) {
        void saveUiSettings({ theme: state.theme, locale: state.locale });
      }
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(clearToast, 2600);
    return () => window.clearTimeout(timer);
  }, [clearToast, toast]);

  return (
    <AppShell>
      <CurrentScreen />
      {toast ? <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div> : null}
    </AppShell>
  );
}
