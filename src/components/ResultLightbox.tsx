import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Star, Trash2, X } from "lucide-react";

export interface LightboxItem {
  id: string;
  title: string;
  src: string;
  createdAt: string;
}

interface ResultLightboxProps {
  items: LightboxItem[];
  index: number;
  favorites: string[];
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (item: LightboxItem) => void;
  onEdit: (item: LightboxItem) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 灯箱图片舞台：滚轮缩放 1–5x，缩放后拖动平移，双击复位；以 key 重挂载实现切换图片时状态重置。 */
function LightboxStage({ item, count, index, onNavigate }: { item: LightboxItem; count: number; index: number; onNavigate: (index: number) => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 原生 wheel 监听以允许 preventDefault（React 合成 wheel 为 passive，无法阻止背景滚动）
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale((current) => {
        const next = clamp(current * (event.deltaY < 0 ? 1.12 : 0.89), 1, 5);
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (scale <= 1) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const dimsLabel = dims ? `${dims.width} × ${dims.height}` : null;

  return (
    <>
      <div className="lightbox-stage" ref={contentRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={(event) => event.stopPropagation()}>
        {scale > 1 ? <span className="lightbox-zoom-hint">拖动平移 · 双击复位</span> : null}
        <img
          src={item.src}
          alt={`${item.title} 大图`}
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: dragging ? "none" : "transform 120ms var(--ease)" }}
          onLoad={(event) => setDims({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onDoubleClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}
        />
      </div>
      <footer className="lightbox-footer" onClick={(event) => event.stopPropagation()}>
        <button className="lightbox-nav" aria-label="上一张" disabled={count <= 1} onClick={() => onNavigate((index - 1 + count) % count)}><ChevronLeft size={18} /></button>
        <div className="lightbox-info">
          <strong>{item.title}</strong>
          <span>{dimsLabel ?? "加载中…"} {dimsLabel ? "·" : null} {index + 1} / {count}</span>
        </div>
        <button className="lightbox-nav" aria-label="下一张" disabled={count <= 1} onClick={() => onNavigate((index + 1) % count)}><ChevronRight size={18} /></button>
      </footer>
    </>
  );
}

/** 结果图片灯箱：深色遮罩完整查看大图，←/→ 或按钮翻页，Esc/遮罩关闭，支持收藏/删除/编辑。 */
export function ResultLightbox({ items, index, favorites, onClose, onNavigate, onToggleFavorite, onDelete, onEdit }: ResultLightboxProps) {
  const item = items[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onNavigate((index - 1 + items.length) % items.length);
      if (event.key === "ArrowRight") onNavigate((index + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;
  const isFavorite = favorites.includes(item.id);

  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label={`${item.title} 大图预览`} onClick={onClose}>
      <header className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-actions">
          <button className={isFavorite ? "is-active" : ""} aria-label="收藏这张图片" title="收藏" onClick={() => onToggleFavorite(item.id)}><Star size={17} fill={isFavorite ? "currentColor" : "none"} /></button>
          <button aria-label="删除这张图片" title="删除" onClick={() => onDelete(item)}><Trash2 size={17} /></button>
          <button aria-label="打开画布编辑" title="编辑（打开画布）" onClick={() => onEdit(item)}><Pencil size={16} /></button>
        </div>
        <button className="lightbox-close" aria-label="关闭预览" title="关闭（Esc）" onClick={onClose}><X size={18} /></button>
      </header>
      <LightboxStage key={item.id} item={item} count={items.length} index={index} onNavigate={onNavigate} />
    </div>
  );
}
