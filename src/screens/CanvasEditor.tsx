import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "fabric";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Crop,
  Eye,
  Hand,
  Layers,
  LoaderCircle,
  Lock,
  MousePointer2,
  Paintbrush,
  Redo2,
  Save,
  Scan,
  Scissors,
  TextCursorInput,
  Trash2,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, IconButton, SectionTitle } from "../components/ui";
import { getPresetSizeOptions, parseDimensionString, type CanvasSize } from "../data/platformPresets";
import { validateEditSubmit } from "../lib/canvasEdit";
import { getProjectPath, saveCanvasDocumentRecord } from "../lib/database";
import { hasTauriRuntime, segmentImage, submitImageGeneration } from "../lib/desktop";
import { exportCanvasDocument, type ExportFormat } from "../lib/exporter";
import { useAppStore } from "../store/appStore";

const pages = [
  { id: "white", label: "主图 01", src: null as string | null },
  { id: "scene", label: "场景 02", src: null },
  { id: "poster", label: "卖点 03", src: null },
  { id: "detail", label: "细节 04", src: null },
];

const persistCanvasDocument = (canvas: Canvas, pageId: string, size: CanvasSize) => {
  if (!hasTauriRuntime()) return;
  void saveCanvasDocumentRecord(pageId, JSON.stringify(canvas.toJSON()), size.width, size.height);
};

export function CanvasEditor() {
  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const saveTimer = useRef<number | null>(null);
  const currentPage = useAppStore((state) => state.selectedCanvasPage);
  const setCurrentPage = useAppStore((state) => state.setCanvasPage);
  const selectedLayer = useAppStore((state) => state.selectedLayerId);
  const setSelectedLayer = useAppStore((state) => state.setSelectedLayer);
  const inspectorTab = useAppStore((state) => state.inspectorTab);
  const setInspectorTab = useAppStore((state) => state.setInspectorTab);
  const canvasSource = useAppStore((state) => state.canvasSource);
  const canvasSourcePath = useAppStore((state) => state.canvasSourcePath);
  const setCanvasSource = useAppStore((state) => state.setCanvasSource);
  const canvasSourceDimensions = useAppStore((state) => state.canvasSourceDimensions);
  const notify = useAppStore((state) => state.notify);
  const [fontSize, setFontSize] = useState(78);
  const [opacity, setOpacity] = useState(100);
  const [prompt, setPrompt] = useState("把橙子换成青柠，保持产品不变");
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useState(72);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const maskModeRef = useRef(false);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | null>(null);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editPayload, setEditPayload] = useState<{ sourceDataUrl: string; annotationDataUrl: string } | null>(null);
  const addTasks = useAppStore((state) => state.addTasks);
  const presetSizeOptions = useMemo(() => getPresetSizeOptions(), []);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(() => {
    if (canvasSourceDimensions) {
      return { width: Math.max(1, Math.round(canvasSourceDimensions.width)), height: Math.max(1, Math.round(canvasSourceDimensions.height)) };
    }
    return parseDimensionString(presetSizeOptions[0]) ?? { width: 1000, height: 1000 };
  });
  const [customSize, setCustomSize] = useState(false);
  const [customWidth, setCustomWidth] = useState(canvasSize.width);
  const [customHeight, setCustomHeight] = useState(canvasSize.height);
  const sizeLabel = `${canvasSize.width} × ${canvasSize.height}`;

  const applyPresetSize = (preset: string) => {
    const size = parseDimensionString(preset);
    if (!size) return;
    setCustomSize(false);
    setCanvasSize(size);
    setCustomWidth(size.width);
    setCustomHeight(size.height);
  };

  const applyCustomSize = () => {
    const width = Math.max(1, Math.round(customWidth));
    const height = Math.max(1, Math.round(customHeight));
    setCanvasSize({ width, height });
    setCustomWidth(width);
    setCustomHeight(height);
  };

  const pageSource = useMemo(() => canvasSource ?? pages.find((page) => page.id === currentPage)?.src ?? null, [canvasSource, currentPage]);
  const canvasBackground = pageSource;

  useEffect(() => {
    if (!canvasElement.current) return;
    const canvas = new Canvas(canvasElement.current, {
      width: canvasSize.width,
      height: canvasSize.height,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selectionColor: "rgba(255, 101, 56, 0.12)",
      selectionBorderColor: "#ff6538",
      selectionLineWidth: 2,
    });
    canvasRef.current = canvas;
    canvas.isDrawingMode = maskModeRef.current;
    canvas.requestRenderAll();

    canvas.on("selection:created", ({ selected }) => {
      const name = selected?.[0]?.get("name");
      if (typeof name === "string") setSelectedLayer(name);
    });
    canvas.on("selection:updated", ({ selected }) => {
      const name = selected?.[0]?.get("name");
      if (typeof name === "string") setSelectedLayer(name);
    });
    const scheduleSave = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => persistCanvasDocument(canvas, currentPage, canvasSize), 800);
    };
    canvas.on("object:modified", scheduleSave);
    canvas.on("text:changed", scheduleSave);
    canvas.on("path:created", ({ path }) => {
      path.set({ name: "mask", evented: false, selectable: false });
      setMaskPreviewUrl(renderMaskPreview(canvas, canvasSize));
      scheduleSave();
    });

    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      persistCanvasDocument(canvas, currentPage, canvasSize);
      canvas.dispose();
      canvasRef.current = null;
    };
  }, [currentPage, pageSource, setSelectedLayer, canvasSize]);

  useEffect(() => {
    maskModeRef.current = maskMode;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = maskMode;
    if (maskMode && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = "#000000";
      canvas.freeDrawingBrush.width = 36;
    }
    canvas.requestRenderAll();
    setMaskPreviewUrl(renderMaskPreview(canvas, canvasSize));
  }, [maskMode, canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const object = canvas.getObjects().find((item) => item.get("name") === "headline");
    if (object) {
      object.set({ fontSize, opacity: opacity / 100 });
      canvas.requestRenderAll();
    }
  }, [fontSize, opacity]);

  const selectLayer = (id: string) => {
    setSelectedLayer(id);
    const object = canvasRef.current?.getObjects().find((item) => item.get("name") === id && item.selectable);
    if (object && canvasRef.current) {
      canvasRef.current.setActiveObject(object);
      canvasRef.current.requestRenderAll();
    }
  };

  const toggleLayer = (id: string) => {
    setVisibleLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      canvasRef.current?.getObjects().filter((item) => item.get("name") === id).forEach((item) => item.set({ visible: next.has(id) }));
      canvasRef.current?.requestRenderAll();
      return next;
    });
  };

  const segmentSource = async () => {
    if (!hasTauriRuntime()) {
      notify("抠图仅在桌面版可用");
      return;
    }
    if (!canvasSourcePath) {
      notify("当前画布没有本地来源图，无法抠图");
      return;
    }
    setSegmenting(true);
    try {
      const projectPath = await getProjectPath();
      if (!projectPath) throw new Error("无法定位项目目录");
      const result = await segmentImage(projectPath, canvasSourcePath);
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      setCanvasSource(convertFileSrc(result.outputPath));
      notify(`抠图完成：${result.width} × ${result.height}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "抠图失败");
    } finally {
      setSegmenting(false);
    }
  };

  const toggleMaskMode = () => setMaskMode((current) => !current);

  const clearMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getObjects().filter((item) => item.get("name") === "mask").forEach((item) => canvas.remove(item));
    canvas.requestRenderAll();
    setMaskPreviewUrl(null);
    persistCanvasDocument(canvas, currentPage, canvasSize);
    notify("已清除蒙版");
  };

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("加载画布图片失败"));
    image.src = src;
  });

  const composeEditPayload = async (): Promise<{ sourceDataUrl: string; annotationDataUrl: string } | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const width = canvasSize.width;
    const height = canvasSize.height;
    if (!canvasBackground) return null;
    const background = await loadImage(canvasBackground);
    // 原图 Data URL（画布同尺寸），APIMart 参考图只接受 HTTPS URL 或 Data URL
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!sourceCtx) return null;
    sourceCtx.drawImage(background, 0, 0, width, height);
    // 蒙版渲染：白笔迹、透明底
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return null;
    canvas.getObjects().filter((item) => item.get("name") === "mask").forEach((item) => item.render(maskCtx));
    // 红色标注：红色矩形 ∩ 蒙版区域
    const redCanvas = document.createElement("canvas");
    redCanvas.width = width;
    redCanvas.height = height;
    const redCtx = redCanvas.getContext("2d");
    if (!redCtx) return null;
    redCtx.fillStyle = "rgba(255, 64, 52, 0.55)";
    redCtx.fillRect(0, 0, width, height);
    redCtx.globalCompositeOperation = "destination-in";
    redCtx.drawImage(maskCanvas, 0, 0);
    // 标注图 = 原图 + 红色蒙版叠加
    const annotationCanvas = document.createElement("canvas");
    annotationCanvas.width = width;
    annotationCanvas.height = height;
    const annotationCtx = annotationCanvas.getContext("2d");
    if (!annotationCtx) return null;
    annotationCtx.drawImage(background, 0, 0, width, height);
    annotationCtx.drawImage(redCanvas, 0, 0);
    return {
      sourceDataUrl: sourceCanvas.toDataURL("image/png"),
      annotationDataUrl: annotationCanvas.toDataURL("image/png"),
    };
  };

  const openEditConfirm = async () => {
    const canvas = canvasRef.current;
    const error = validateEditSubmit({
      desktop: hasTauriRuntime(),
      prompt,
      hasMask: Boolean(canvas?.getObjects().some((item) => item.get("name") === "mask")),
    });
    if (error) {
      notify(error);
      return;
    }
    setConfirmingEdit(true);
    try {
      const payload = await composeEditPayload();
      if (!payload) throw new Error("合成蒙版标注图失败");
      setEditPayload(payload);
      setEditConfirmOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "准备局部编辑失败");
    } finally {
      setConfirmingEdit(false);
    }
  };

  const submitEdit = async () => {
    if (!editPayload) return;
    setSubmittingEdit(true);
    try {
      const submission = await submitImageGeneration({
        prompt: `${prompt}（仅编辑图中红色高亮标注的区域，其余部分保持不变，不要改变未标注内容）`,
        size: `${canvasSize.width}x${canvasSize.height}`,
        resolution: "1k",
        imageUrls: [editPayload.sourceDataUrl, editPayload.annotationDataUrl],
      });
      addTasks([{
        id: crypto.randomUUID(),
        providerTaskId: submission.taskId,
        title: `局部编辑 · ${prompt.trim().slice(0, 16)}…`,
        dimensions: sizeLabel,
        project: "当前项目",
        provider: "GPT-Image-2",
        status: "queued",
        progress: 0,
        cost: "待结算",
        elapsed: "00:00:00",
      }]);
      setEditConfirmOpen(false);
      notify("局部编辑任务已提交，可在任务中心查看");
    } catch (error) {
      notify(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const exportDocument = async (format: ExportFormat) => {
    if (!canvasRef.current) return;
    setExporting(format);
    try {
      if (!canvasBackground) {
        notify("没有可导出的画布内容");
        return;
      }
      const saved = await exportCanvasDocument(canvasRef.current, canvasBackground, format, canvasSize);
      if (saved) {
        notify("导出完成");
        setExportOpen(false);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
    <div className="editor-screen">
      <div className="editor-toolbar">
        <div className="tool-group"><IconButton label="撤销"><Undo2 size={18} /></IconButton><IconButton label="重做"><Redo2 size={18} /></IconButton></div>
        <div className="tool-group tool-group--modes">
          <IconButton label="选择" active><MousePointer2 size={18} /><span>选择</span></IconButton>
          <IconButton label="裁剪"><Crop size={18} /><span>裁剪</span></IconButton>
          <IconButton label="蒙版笔刷" active={maskMode} onClick={toggleMaskMode}><Paintbrush size={18} /><span>蒙版笔刷</span></IconButton>
          <IconButton label="抓手"><Hand size={18} /><span>抓手</span></IconButton>
          <IconButton label={segmenting ? "抠图中…" : "抠图"} onClick={() => void segmentSource()}><Scissors size={18} /><span>{segmenting ? "抠图中…" : "抠图"}</span></IconButton>
        </div>
        <div className="tool-fields"><label>X <input value="120" readOnly /></label><label>Y <input value="156" readOnly /></label><label>W <input value="760" readOnly /></label><label>H <input value="176" readOnly /></label><Lock size={16} /></div>
        <div className="tool-group"><IconButton label="左对齐"><AlignLeft size={18} /></IconButton><IconButton label="居中"><AlignCenter size={18} /></IconButton><IconButton label="右对齐"><AlignRight size={18} /></IconButton></div>
        <label className="canvas-size-select">尺寸 <select value={customSize ? "custom" : sizeLabel} onChange={(event) => { if (event.target.value === "custom") setCustomSize(true); else applyPresetSize(event.target.value); }}>{presetSizeOptions.map((preset) => <option key={preset}>{preset}</option>)}{<option value="custom">自定义…</option>}</select></label>
        <button className="zoom-select">{zoom}% <ChevronDown size={14} /></button>
        <Button variant="primary" icon={<Save size={16} />} onClick={() => setExportOpen(true)}>导出</Button>
      </div>

      <aside className="editor-sidebar">
        <SectionTitle>页面与图层</SectionTitle>
        <h3>页面</h3>
        <div className="page-strip">
          {pages.map((page) => <button key={page.id} className={currentPage === page.id ? "is-active" : ""} onClick={() => setCurrentPage(page.id)}>{page.src ? <img src={page.src} alt="" /> : <span className="page-strip__blank" />}<span>{page.label}</span></button>)}
        </div>
        <h3>图层</h3>
        <div className="layer-list">
          {selectedLayer === "headline" && visibleLayers.has("headline") ? (
            <button className="is-active" onClick={() => selectLayer("headline")}>
              <TextCursorInput size={18} /><span>标题文本</span>
              <i onClick={(event) => { event.stopPropagation(); toggleLayer("headline"); }}><Eye size={16} /></i>
              <Unlock size={15} />
            </button>
          ) : null}
          {!selectedLayer && visibleLayers.size === 0 ? <p className="layer-list__empty">暂无图层，从结果页加入图片后可编辑。</p> : null}
        </div>
        <div className="layer-footer"><Button size="sm" icon={<Layers size={15} />} disabled>新建图层</Button><IconButton label="删除图层" disabled><Trash2 size={16} /></IconButton></div>
      </aside>

      <section className="canvas-workspace">
        <div className="canvas-ruler canvas-ruler--top">{rulerMarks(canvasSize.width).map((mark) => <span key={mark}>{mark}</span>)}</div>
        <div className="canvas-ruler canvas-ruler--left">{rulerMarks(canvasSize.height).map((mark) => <span key={mark}>{mark}</span>)}</div>
        <div className="canvas-stage"><div className="canvas-host" style={{ backgroundImage: `url(${canvasBackground})`, aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}><canvas ref={canvasElement} /></div></div>
        <div className="canvas-controls">
          {customSize ? <label className="custom-size-fields">宽 <input type="number" min="1" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /> px 高 <input type="number" min="1" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /> px <button onClick={applyCustomSize}>应用</button></label> : null}
          <Button size="sm" icon={<Scan size={15} />}>适合画布</Button><ZoomOut size={16} /><input type="range" min="35" max="120" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><ZoomIn size={16} /><label>对比 <input type="checkbox" /></label>
        </div>
      </section>

      <aside className="canvas-inspector">
        <div className="inspector-tabs"><button className={inspectorTab === "properties" ? "is-active" : ""} onClick={() => setInspectorTab("properties")}>属性</button><button className={inspectorTab === "ai" ? "is-active" : ""} onClick={() => setInspectorTab("ai")}>AI 局部编辑</button></div>
        <div className="canvas-inspector__body">
          <section className="property-section">
            <header>文本 <ChevronDown size={15} /></header>
            <button className="field-select">HarmonyOS Sans SC <ChevronDown size={14} /></button>
            <div className="field-row"><button className="field-select">粗体 <ChevronDown size={14} /></button><label><input type="number" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /> px</label></div>
            <label className="color-field"><i />#FFFFFF</label>
            <div className="field-row"><label>行高 <input value="1.2" readOnly /></label><label>字距 <input value="0" readOnly /></label></div>
            <div className="alignment-row"><button><AlignLeft size={18} /></button><button className="is-active"><AlignCenter size={18} /></button><button><AlignRight size={18} /></button></div>
            <label className="opacity-field">不透明度 <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><b>{opacity}%</b></label>
          </section>
          <button className="property-collapse">描边与阴影 <ChevronDown size={15} /></button>
          <button className="property-collapse">位置与尺寸 <ChevronDown size={15} /></button>
          <section className="ai-edit-section">
            <header>AI 局部编辑 <ChevronDown size={15} /></header>
            <div className="mask-row"><span>蒙版区域</span><div className="mask-preview">{maskPreviewUrl ? <img src={maskPreviewUrl} alt="蒙版预览" /> : <><i /><i /></>}</div><IconButton label={maskMode ? "退出蒙版" : "编辑蒙版"} active={maskMode} onClick={toggleMaskMode}><Paintbrush size={16} /></IconButton>{maskPreviewUrl ? <IconButton label="清除蒙版" onClick={clearMask}><Trash2 size={16} /></IconButton> : null}</div>
            <label>编辑指令<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /><small>{prompt.length}/200</small></label>
            <Button variant="primary" className="full-width" onClick={() => void openEditConfirm()}>{confirmingEdit ? "正在准备…" : "生成局部修改"}</Button>
          </section>
        </div>
      </aside>

      <footer className="editor-status"><span>{sizeLabel} px</span><span>RGB / sRGB</span><span>● 自动保存中 10:32:18</span><span>● 本地保存 10:32:18</span><span>内存使用 1.24 GB / 8.00 GB</span></footer>
    </div>
    {exportOpen ? (
      <div className="modal-backdrop" role="presentation">
        <section className="confirm-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <header><div><small>本地导出</small><h2 id="export-title">选择文件格式</h2></div><button aria-label="关闭" onClick={() => setExportOpen(false)}><X size={18} /></button></header>
          <div className="export-options">
            {([
              ["png", "PNG", "无损图片，适合平台上传"],
              ["jpg", "JPG", "高质量压缩，文件更小"],
              ["webp", "WebP", "现代网页图片格式"],
              ["psd", "分层 PSD", "背景与可编辑叠加层"],
              ["zip", "工程包", "画布 JSON、清单与预览"],
              ["long", "详情长图", "PNG 长图输出"],
            ] as const).map(([format, title, description]) => <button key={format} disabled={Boolean(exporting)} onClick={() => void exportDocument(format)}><strong>{exporting === format ? "导出中…" : title}</strong><span>{description}</span></button>)}
          </div>
          <p>所有文件都在本地合成；导出不会调用云端 API。</p>
        </section>
      </div>
    ) : null}
    {editConfirmOpen ? (
      <div className="modal-backdrop" role="presentation">
        <section className="confirm-modal edit-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="edit-confirm-title">
          <header><div><small>付费操作确认</small><h2 id="edit-confirm-title">提交局部 AI 编辑</h2></div><button aria-label="关闭" onClick={() => setEditConfirmOpen(false)}><X size={18} /></button></header>
          <dl>
            <div><dt>编辑指令</dt><dd>{prompt}</dd></div>
            <div><dt>上传原图</dt><dd className="edit-thumbs"><img src={editPayload?.sourceDataUrl} alt="原图" /></dd></div>
            <div><dt>上传蒙版标注</dt><dd className="edit-thumbs"><img src={editPayload?.annotationDataUrl} alt="蒙版标注图" /></dd></div>
            <div><dt>参考图策略</dt><dd>APIMart 不支持原生遮罩参数，将“原图 + 红色标注蒙版”作为两张参考图上传</dd></div>
            <div><dt>尺寸 / 清晰度</dt><dd>{sizeLabel} · 1K</dd></div>
            <div><dt>预估费用</dt><dd className="cost-value">¥0.80</dd></div>
          </dl>
          <p>结果将以新任务返回，可在任务中心查看并加入画布，不会覆盖当前图层。实际费用以供应商结算为准。</p>
          <footer><Button onClick={() => setEditConfirmOpen(false)}>返回调整</Button><Button variant="primary" disabled={submittingEdit} onClick={() => void submitEdit()} icon={submittingEdit ? <LoaderCircle className="spin" size={16} /> : undefined}>{submittingEdit ? "正在提交…" : "确认付费并提交"}</Button></footer>
        </section>
      </div>
    ) : null}
    </>
  );
}

const renderMaskPreview = (canvas: Canvas, size: CanvasSize): string | null => {
  const maskObjects = canvas.getObjects().filter((item) => item.get("name") === "mask");
  if (!maskObjects.length) return null;
  const scale = Math.min(1, 240 / Math.max(1, size.width));
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(size.width * scale));
  offscreen.height = Math.max(1, Math.round(size.height * scale));
  const ctx = offscreen.getContext("2d");
  if (!ctx) return null;
  ctx.save();
  ctx.scale(scale, scale);
  maskObjects.forEach((item) => item.render(ctx));
  ctx.restore();
  return offscreen.toDataURL("image/png");
};

const rulerMarks = (pixels: number) => {
  const step = pixels > 2000 ? 500 : pixels > 1200 ? 300 : 200;
  const marks: number[] = [];
  for (let value = 0; value <= pixels; value += step) marks.push(value);
  if (marks[marks.length - 1] !== pixels) marks.push(pixels);
  return marks;
};
