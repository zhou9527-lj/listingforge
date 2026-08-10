import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, ImageOff, List, Maximize2, RefreshCcw, Star, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { AgentPanel } from "../components/AgentPanel";
import { ResultLightbox } from "../components/ResultLightbox";
import { Button, CheckBox, SectionTitle, StatusDot } from "../components/ui";
import { deleteProjectResultFile, hasTauriRuntime } from "../lib/desktop";
import { deleteResultRecords, getProjectPath, loadPersistedResults } from "../lib/database";
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

/** 结果生成时间：当天显示「今天 HH:mm」，其余显示「MM-DD HH:mm」。 */
const formatCreatedAt = (iso: string): string => {
  const date = new Date(iso);
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === now.toDateString() ? `今天 ${hhmm}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`;
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
  const pruneResultSelection = useAppStore((state) => state.pruneResultSelection);
  const notify = useAppStore((state) => state.notify);
  const [realResults, setRealResults] = useState<RealResult[]>([]);
  const [scope, setScope] = useState<"all" | "recent">("all");
  const [sort, setSort] = useState<"time" | "type">("time");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<RealResult[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // 已加载图片的宽高比（null 前默认按 1:1 占位，加载后重排）
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const galleryRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  // 瀑布流容器宽度：callback ref 在 div 挂载/卸载时同步测量并挂 ResizeObserver（React 19 支持 ref cleanup），
  // 天然覆盖 空态 ⇄ 卡片、grid ⇄ list 的条件渲染切换，无 effect 依赖时序问题
  const attachGallery = useCallback((el: HTMLDivElement | null) => {
    galleryRef.current = el;
    if (!el) return;
    // 列宽计算基于内容盒：clientWidth 含水平 padding，需剥离
    const update = () => {
      const style = getComputedStyle(el);
      setContainerWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // 瀑布流：宽窗口 3 列、窄窗口 2 列（与 ≤1359px 布局断点对齐——1586 窗口因 inspector 占位容器反而比 1280 窄，故用窗口宽度而非容器宽度）
  // 卡片高度 = 列宽 / 宽高比，长图封顶 2 倍列宽（顶部完整显示）
  const colCount = window.innerWidth >= 1360 ? 3 : 2;
  const colWidth = containerWidth > 0 ? (containerWidth - 10 * (colCount - 1)) / colCount : 0;
  const cardHeight = (item: RealResult) => Math.min(colWidth / (ratios[item.id] ?? 1), colWidth * 2);
  // 轮转分配列：第 1 张进第 1 列、第 2 张进第 2 列…保持从左到右的时间浏览顺序
  const columns = useMemo(() => {
    const cols: Array<Array<(typeof visibleItems)[number]>> = Array.from({ length: colCount }, () => []);
    visibleItems.forEach((item, index) => cols[index % colCount].push(item));
    return cols;
  }, [colCount, visibleItems]);

  const editRealResult = (result: RealResult) => {
    openResultInCanvas(result.src, undefined, result.localPath);
    notify("已从本地结果打开画布");
  };

  /** 删除结果记录并同步删除本地图片文件（Rust 侧仅允许删除项目 results/ 目录内的文件） */
  const executeDelete = async (items: RealResult[]) => {
    const ids = items.map((item) => item.id);
    setDeleting(true);
    try {
      const refs = await deleteResultRecords(ids);
      if (hasTauriRuntime()) {
        const projectPath = await getProjectPath();
        if (projectPath) {
          await Promise.all(refs.map((ref) => ref.localPath ? deleteProjectResultFile(projectPath, ref.localPath).catch(() => {}) : Promise.resolve()));
        }
      }
      pruneResultSelection(ids);
      setRealResults((current) => current.filter((item) => !ids.includes(item.id)));
      setDeleteTarget(null);
      setLightboxIndex(null);
      notify(`已删除 ${ids.length} 张结果图片${refs.some((ref) => ref.localPath) ? "，本地文件已同步删除" : "（无本地文件）"}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  /** 悬停控制层通用片段：选择框 / 收藏 / 删除 / 底部信息条（编辑）。 */
  const cardOverlay = (item: RealResult & { type: ResultType }, isSelected: boolean, isFavorite: boolean) => (
    <div className="result-card__overlay">
      <div className="result-card__check" onClick={(event) => event.stopPropagation()}><CheckBox checked={isSelected} label={`选择${item.title}`} onChange={() => toggleResult(item.id)} /></div>
      <div className="result-card__controls">
        <button className={`result-card__favorite ${isFavorite ? "is-active" : ""}`} aria-label="收藏" onClick={(event) => { event.stopPropagation(); toggleFavorite(item.id); }}><Star size={17} fill={isFavorite ? "currentColor" : "none"} /></button>
        <button className="result-card__delete" aria-label="删除这张图片" title="删除这张图片" onClick={(event) => { event.stopPropagation(); setDeleteTarget([item]); }}><Trash2 size={15} /></button>
      </div>
      <div className="result-card__meta">
        <span><strong>{item.title}</strong><em>{item.type} · {formatCreatedAt(item.createdAt)}</em></span>
        <button onClick={(event) => { event.stopPropagation(); editRealResult(item); }}>编辑</button>
      </div>
    </div>
  );

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
            <Button icon={<Trash2 size={16} />} disabled={selected.length === 0} onClick={() => setDeleteTarget(visibleItems.filter((item) => selected.includes(item.id)))}>删除所选</Button>
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
              <div className="view-toggle"><button aria-label="瀑布流视图" title="瀑布流" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}><Grid2X2 size={17} /></button><button aria-label="列表视图" title="列表" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><List size={17} /></button></div>
            </div>
            {view === "list" ? (
              <div className="result-gallery result-gallery--list">
                {visibleItems.map((item) => {
                  const isSelected = selected.includes(item.id);
                  const isFavorite = favorites.includes(item.id);
                  return (
                    <article key={item.id} className={`result-card ${isSelected ? "is-selected" : ""}`} onClick={() => setLightboxIndex(visibleItems.indexOf(item))}>
                      <img src={item.src} alt={`${item.title}候选图`} />
                      {cardOverlay(item, isSelected, isFavorite)}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="result-gallery" ref={attachGallery}>
                {columns.map((column, columnIndex) => (
                  <div key={columnIndex} className="result-gallery__column">
                    {column.map((item) => {
                      const isSelected = selected.includes(item.id);
                      const isFavorite = favorites.includes(item.id);
                      const height = cardHeight(item);
                      const capped = height >= colWidth * 2 - 0.5;
                      return (
                        <article key={item.id} className={`result-card ${isSelected ? "is-selected" : ""} ${capped ? "is-capped" : ""}`} onClick={() => setLightboxIndex(visibleItems.indexOf(item))}>
                          <img
                            src={item.src}
                            alt={`${item.title}候选图`}
                            style={{ height: colWidth ? height : "auto" }}
                            onLoad={(event) => {
                              const { naturalWidth, naturalHeight } = event.currentTarget;
                              if (naturalWidth > 0 && naturalHeight > 0) {
                                setRatios((current) => current[item.id] === naturalWidth / naturalHeight ? current : { ...current, [item.id]: naturalWidth / naturalHeight });
                              }
                            }}
                          />
                          {capped ? <span className="result-card__expand"><Maximize2 size={12} />查看全图</span> : null}
                          {cardOverlay(item, isSelected, isFavorite)}
                        </article>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <AgentPanel mode="review" reviewTarget={visibleItems[0] ?? null} />

      {lightboxIndex !== null ? (
        <ResultLightbox
          items={visibleItems}
          index={lightboxIndex}
          favorites={favorites}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onToggleFavorite={toggleFavorite}
          onDelete={(item) => {
            const real = visibleItems.find((result) => result.id === item.id);
            if (real) setDeleteTarget([real]);
          }}
          onEdit={(item) => {
            const real = visibleItems.find((result) => result.id === item.id);
            if (real) editRealResult(real);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="删除结果图片">
            <header><h2>删除结果图片</h2><button className="modal-close" aria-label="关闭" onClick={() => setDeleteTarget(null)}><X size={16} /></button></header>
            <p className="modal-warning">将删除 {deleteTarget.length} 张结果图片及其本地文件（任务记录保留），不可恢复。确定继续吗？</p>
            <footer className="modal-actions">
              <Button onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="danger" disabled={deleting} onClick={() => void executeDelete(deleteTarget)}>{deleting ? "删除中…" : "确认删除"}</Button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
