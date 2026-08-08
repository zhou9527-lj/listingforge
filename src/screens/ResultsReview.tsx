import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Grid2X2, List, RefreshCcw, Star, Upload, WandSparkles } from "lucide-react";
import { AgentPanel } from "../components/AgentPanel";
import { Button, CheckBox, SectionTitle, StatusDot } from "../components/ui";
import { resultItems } from "../data/demo";
import { hasTauriRuntime } from "../lib/desktop";
import { loadPersistedResults } from "../lib/database";
import { useAppStore } from "../store/appStore";

const filters = [
  { id: "all" as const, label: "全部", count: 8 },
  { id: "white" as const, label: "白底主图", count: 2 },
  { id: "scene" as const, label: "场景主图", count: 2 },
  { id: "poster" as const, label: "卖点海报", count: 2 },
  { id: "detail" as const, label: "细节长图", count: 2 },
];

interface RealResult {
  id: string;
  taskId: string;
  title: string;
  src: string;
  localPath: string;
}

const localResultSrc = async (localPath: string): Promise<string> => {
  if (!hasTauriRuntime()) return localPath;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(localPath);
};

export function ResultsReview() {
  const filter = useAppStore((state) => state.resultFilter);
  const setFilter = useAppStore((state) => state.setResultFilter);
  const selected = useAppStore((state) => state.selectedResults);
  const favorites = useAppStore((state) => state.favoriteResults);
  const toggleResult = useAppStore((state) => state.toggleResult);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const setScreen = useAppStore((state) => state.setScreen);
  const openResultInCanvas = useAppStore((state) => state.openResultInCanvas);
  const notify = useAppStore((state) => state.notify);
  const [realResults, setRealResults] = useState<RealResult[]>([]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    void loadPersistedResults()
      .then(async (rows) => {
        const items = await Promise.all(rows.map(async (row) => ({
          id: row.id,
          taskId: row.task_id,
          title: row.task_title,
          localPath: row.local_path!,
          src: await localResultSrc(row.local_path!),
        })));
        setRealResults(items);
      })
      .catch((error) => notify(error instanceof Error ? error.message : "读取本地结果失败"));
  }, [notify]);

  const visibleItems = useMemo(() => {
    const demo = filter === "all" ? resultItems : resultItems.filter((item) => item.type === filter);
    if (filter !== "all") return demo;
    return [...demo, ...realResults.map((item) => ({ id: `real-${item.id}`, type: "scene" as const, label: "真实结果", ratio: "1:1" as const, src: item.src }))];
  }, [filter, realResults]);

  const editRealResult = (result: RealResult) => {
    openResultInCanvas(result.src, undefined, result.localPath);
    notify("已从本地结果打开画布");
  };

  return (
    <div className="screen-layout screen-layout--results">
      <aside className="context-sidebar result-sidebar">
        <SectionTitle>生成结果</SectionTitle>
        <div className="filter-list">
          {filters.map((item) => <button key={item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}><span>{item.label}</span><b>{item.count}</b></button>)}
        </div>
        <button className="sidebar-select">淘宝 / 天猫 <ChevronDown size={14} /></button>
        <div className="history-list">
          <h3>任务历史</h3>
          {["2024-05-20 10:24", "2024-05-20 09:18", "2024-05-19 16:47", "2024-05-19 11:02"].map((time, index) => (
            <button key={time} className={index === 0 ? "is-active" : ""}><strong>{time}</strong><span>8 张 · ¥{index === 0 ? "6.36" : "6.40"} · 3分{42 - index * 3}秒</span><StatusDot tone="success" /></button>
          ))}
        </div>
      </aside>

      <section className="workspace results-workspace">
        <header className="results-header">
          <div><SectionTitle>候选结果</SectionTitle><p><StatusDot tone="success" /> 8 张完成 · ¥6.36 · 3分42秒</p><p className="warning-text">△ 1 张文字需复核</p></div>
          <div className="results-actions">
            <Button icon={<RefreshCcw size={16} />} onClick={() => notify("已创建同参数重新生成任务")}>重新生成</Button>
            <Button variant="primary" icon={<WandSparkles size={16} />} onClick={() => setScreen("canvas")}>加入画布</Button>
            <Button icon={<Upload size={16} />} onClick={() => notify(`已准备导出 ${selected.length} 张图片`)}>导出所选</Button>
          </div>
        </header>
        <div className="gallery-toolbar">
          <span />
          <button>本轮生成 <ChevronDown size={14} /></button>
          <button>按类型 <ChevronDown size={14} /></button>
          <div className="view-toggle"><button className="is-active"><Grid2X2 size={17} /></button><button><List size={17} /></button></div>
        </div>
        <div className="result-gallery">
          {visibleItems.map((item) => {
            const isSelected = selected.includes(item.id);
            const isFavorite = favorites.includes(item.id);
            const isReal = item.id.startsWith("real-");
            const real = realResults.find((entry) => `real-${entry.id}` === item.id);
            return (
              <article key={item.id} className={`result-card ${isSelected ? "is-selected" : ""}`}>
                <img src={item.src} alt={`${item.label}候选图`} />
                <div className="result-card__check"><CheckBox checked={isSelected} label={`选择${item.label}`} onChange={() => toggleResult(item.id)} /></div>
                <button className={`result-card__favorite ${isFavorite ? "is-active" : ""}`} aria-label="收藏" onClick={() => toggleFavorite(item.id)}><Star size={17} fill={isFavorite ? "currentColor" : "none"} /></button>
                <div className="result-card__meta"><span>{item.label} {item.ratio}{isReal ? <em className="local-badge">本地</em> : null}</span><button onClick={() => { if (real) editRealResult(real); else setScreen("canvas"); }}>编辑</button></div>
              </article>
            );
          })}
        </div>
      </section>

      <AgentPanel mode="review" />
    </div>
  );
}
