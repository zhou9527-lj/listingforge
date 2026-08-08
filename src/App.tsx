import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { ApiSettings } from "./screens/ApiSettings";
import { CanvasEditor } from "./screens/CanvasEditor";
import { GenerationWorkbench } from "./screens/GenerationWorkbench";
import { ResultsReview } from "./screens/ResultsReview";
import { TaskCenter } from "./screens/TaskCenter";
import { hasTauriRuntime } from "./lib/desktop";
import { loadPersistedTasks, loadUiSettings, saveUiSettings } from "./lib/database";
import { useAppStore } from "./store/appStore";

function CurrentScreen() {
  const screen = useAppStore((state) => state.screen);
  if (screen === "results") return <ResultsReview />;
  if (screen === "canvas") return <CanvasEditor />;
  if (screen === "tasks") return <TaskCenter />;
  if (screen === "settings") return <ApiSettings />;
  return <GenerationWorkbench />;
}

export default function App() {
  const toast = useAppStore((state) => state.toast);
  const clearToast = useAppStore((state) => state.clearToast);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    void Promise.all([loadPersistedTasks(), loadUiSettings()])
      .then(([tasks, settings]) => useAppStore.getState().hydrateLocalState(tasks, settings))
      .catch((error) => useAppStore.getState().notify(error instanceof Error ? error.message : "读取本地数据库失败"));

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
