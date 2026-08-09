import { useEffect, useMemo, useState } from "react";
import { Grid2X2, ImageOff, List, RefreshCcw, Star, Upload, WandSparkles } from "lucide-react";
import { AgentPanel } from "../components/AgentPanel";
import { Button, CheckBox, SectionTitle, StatusDot } from "../components/ui";
import { hasTauriRuntime } from "../lib/desktop";
import { loadPersistedResults } from "../lib/database";
import { useAppStore } from "../store/appStore";

type ResultType = "all" | "white" | "scene" | "poster" | "detail";

const filters: Array<{ id: ResultType; label: string }> = [
  { id: "all", label: "全部" },
  { id: "white", label: "白底主图" },
  { id: "scene", label: "场景主图" },
  { id: "poster", label: "卖点海报" },
  { id: "detail", label: "细节长图" },
];

/** 从任务标题推断结果类型（标题由生成计划命名，如「白底主图 · 第 1/1 张」）。 */
const guessType = (title: string): Exclude<ResultType, "all"> => {
  if (title.includes("白底")) return "white";
  if (title.includes("场景")) return "scene";
  if (title.includes("海报")) return "poster";
  return "detail";
};

interface RealResult {
  id: string;
  taskId: string;
  title: string;
  src: string;
  localPath: string;
  createdAt: string;
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
  const [scope, setScope] = useState<"all" | "recent">("all");
  const [sort, setSort] = useState<"time" | "type">("time");
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await loadPersistedResults();
        const items = await Promise.all(rows.map(async (row) => ({
          id: row.id,
          taskId: row.task_id,
          title: row.task_title,
          localPath: row.local_path!,
          createdAt: row.created_at,
          src: await localResultSrc(row.local_path!),
        })));
        if (!cancelled) setRealResults(items);
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "读取本地结果失败");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const visibleItems = useMemo(() => {
    const newest = realResults[0]?.createdAt;
    const scoped = scope === "recent" && newest ? realResults.filter((item) => item.createdAt === newest) : realResults;
    const items = filter === "all" ? scoped : scoped.filter((item) => guessType(item.title) === filter);
    return items.map((item) => ({ ...item, type: guessType(item.title) })).sort((a, b) => sort === "type" ? a.type.localeCompare(b.type) : b.createdAt.localeCompare(a.createdAt));
  }, [filter, realResults, scope, sort]);

  const countByType = useMemo(() => {
    const counts: Record<ResultType, number> = { all: realResults.length, white: 0, scene: 0, poster: 0, detail: 0 };
    for (const item of realResults) counts[guessType(item.title)] += 1;
    return counts;
  }, [realResults]);

  const editRealResult = (result: RealResult) => {
    openResultInCanvas(result.src, undefined, result.localPath);
    notify("已从本地结果打开画布");
  };

  return (
    <div className="screen-layout screen-layout--results">
      <aside className="context-sidebar result-sidebar">
        <SectionTitle>生成结果</SectionTitle>
        <div className="filter-list">
          {filters.map((item) => <button key={item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}><span>{item.label}</span><b>{countByType[item.id]}</b></button>)}
        </div>
      </aside>

      <section className="workspace results-workspace">
        <header className="results-header">
          <div><SectionTitle>候选结果</SectionTitle><p><StatusDot tone="success" /> {realResults.length} 张本地结果</p></div>
          <div className="results-actions">
            <Button icon={<RefreshCcw size={16} />} onClick={() => setScreen("generate")}>重新生成</Button>
            <Button variant="primary" icon={<WandSparkles size={16} />} disabled={visibleItems.length === 0} onClick={() => { if (visibleItems[0]) editRealResult(visibleItems[0]); }}>加入画布</Button>
            <Button icon={<Upload size={16} />} disabled={selected.length === 0} onClick={() => { notify(`已选择 ${selected.length} 张图片，请在导出中心完成本地导出`); setScreen("exports"); }}>导出所选</Button>
          </div>
        </header>
        {visibleItems.length === 0 ? (
          <div className="empty-state">
            <ImageOff size={40} strokeWidth={1.4} />
            <h3>{filter === "all" ? "还没有生成结果" : `暂无「${filters.find((item) => item.id === filter)?.label}」`}</h3>
            <p>在生成工作台提交任务，完成后图片会自动出现在这里。</p>
            <Button variant="primary" onClick={() => setScreen("generate")}>去生成</Button>
          </div>
        ) : (
          <>
            <div className="gallery-toolbar">
              <span />
              <label>范围<select aria-label="结果范围" value={scope} onChange={(event) => setScope(event.target.value as "all" | "recent")}><option value="all">全部结果</option><option value="recent">最近一次任务</option></select></label>
              <label>排序<select aria-label="结果排序" value={sort} onChange={(event) => setSort(event.target.value as "time" | "type")}><option value="time">按生成时间</option><option value="type">按类型</option></select></label>
              <div className="view-toggle"><button aria-label="网格视图" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}><Grid2X2 size={17} /></button><button aria-label="列表视图" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><List size={17} /></button></div>
            </div>
            <div className={`result-gallery ${view === "list" ? "result-gallery--list" : ""}`}>
              {visibleItems.map((item) => {
                const isSelected = selected.includes(item.id);
                const isFavorite = favorites.includes(item.id);
                return (
                  <article key={item.id} className={`result-card ${isSelected ? "is-selected" : ""}`}>
                    <img src={item.src} alt={`${item.title}候选图`} />
                    <div className="result-card__check"><CheckBox checked={isSelected} label={`选择${item.title}`} onChange={() => toggleResult(item.id)} /></div>
                    <button className={`result-card__favorite ${isFavorite ? "is-active" : ""}`} aria-label="收藏" onClick={() => toggleFavorite(item.id)}><Star size={17} fill={isFavorite ? "currentColor" : "none"} /></button>
                    <div className="result-card__meta"><span>{item.title}<em className="local-badge">本地</em></span><button onClick={() => editRealResult(item)}>编辑</button></div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <AgentPanel mode="review" reviewTarget={visibleItems[0] ?? null} />
    </div>
  );
}
