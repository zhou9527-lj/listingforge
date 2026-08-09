import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, FabricObject, Textbox } from "fabric";
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
import { getProjectPath, loadCanvasDocumentRecord, saveCanvasDocumentRecord } from "../lib/database";
import { hasTauriRuntime, segmentImage, submitImageGeneration } from "../lib/desktop";
import { exportCanvasDocument, type ExportFormat } from "../lib/exporter";
import { useAppStore } from "../store/appStore";
import { createId } from "../lib/ids";

const pages = [
  { id: "white", label: "主图 01", src: null as string | null },
  { id: "scene", label: "场景 02", src: null },
  { id: "poster", label: "卖点 03", src: null },
  { id: "detail", label: "细节 04", src: null },
];

FabricObject.customProperties = ["name", "layerLabel"];

const persistCanvasDocument = (canvas: Canvas, pageId: string, size: CanvasSize) => {
  if (!hasTauriRuntime()) return;
  void saveCanvasDocumentRecord(pageId, JSON.stringify(canvas.toJSON()), size.width, size.height);
};

export function CanvasEditor() {
  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const saveTimer = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringHistory = useRef(false);
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
  const [lockedLayers, setLockedLayers] = useState<Set<string>>(() => new Set());
  const [layerIds, setLayerIds] = useState<string[]>([]);
  const [toolMode, setToolMode] = useState<"select" | "crop" | "mask" | "hand">("select");
  const [selectionBounds, setSelectionBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [fontFamily, setFontFamily] = useState("HarmonyOS Sans SC");
  const [fontWeight, setFontWeight] = useState<"normal" | "bold">("bold");
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">("center");
  const [textColor, setTextColor] = useState("#ffffff");
  const [lineHeight, setLineHeight] = useState(1.2);
  const [charSpacing, setCharSpacing] = useState(0);
  const [compare, setCompare] = useState(false);
  const [strokeOpen, setStrokeOpen] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [savedAt, setSavedAt] = useState(() => new Date().toLocaleTimeString("zh-CN", { hour12: false }));
  const [memoryLabel, setMemoryLabel] = useState("内存由系统管理");
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
    const updateMemory = () => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (memory) setMemoryLabel(`内存 ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(0)} MB / ${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0)} MB`);
    };
    updateMemory();
    const timer = window.setInterval(updateMemory, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const syncLayers = (canvas: Canvas) => {
    const objects = canvas.getObjects().filter((item) => item.get("name") !== "mask");
    const ids = objects.map((item) => String(item.get("name") ?? "")).filter(Boolean);
    setLayerIds(ids);
    setVisibleLayers(new Set(objects.filter((item) => item.visible !== false).map((item) => String(item.get("name")))));
    setLockedLayers(new Set(objects.filter((item) => !item.selectable).map((item) => String(item.get("name")))));
  };

  const syncSelection = (canvas: Canvas) => {
    const object = canvas.getActiveObject();
    if (!object) {
      setSelectionBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    setSelectionBounds({
      x: Math.round(object.left ?? 0),
      y: Math.round(object.top ?? 0),
      width: Math.round(object.getScaledWidth()),
      height: Math.round(object.getScaledHeight()),
    });
  };

  const captureHistory = (canvas: Canvas) => {
    if (restoringHistory.current) return;
    const snapshot = JSON.stringify(canvas.toJSON());
    const current = historyRef.current.slice(0, historyIndexRef.current + 1);
    if (current[current.length - 1] === snapshot) return;
    historyRef.current = [...current, snapshot].slice(-40);
    historyIndexRef.current = historyRef.current.length - 1;
  };

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
      syncSelection(canvas);
    });
    canvas.on("selection:updated", ({ selected }) => {
      const name = selected?.[0]?.get("name");
      if (typeof name === "string") setSelectedLayer(name);
      syncSelection(canvas);
    });
    canvas.on("selection:cleared", () => syncSelection(canvas));
    const scheduleSave = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        persistCanvasDocument(canvas, currentPage, canvasSize);
        setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }, 800);
      captureHistory(canvas);
      syncSelection(canvas);
    };
    canvas.on("object:modified", scheduleSave);
    canvas.on("text:changed", scheduleSave);
    canvas.on("path:created", ({ path }) => {
      path.set({ name: "mask", evented: false, selectable: false });
      setMaskPreviewUrl(renderMaskPreview(canvas, canvasSize));
      scheduleSave();
    });

    const loadSaved = async () => {
      try {
        const record = await loadCanvasDocumentRecord(currentPage);
        if (record?.document_json) await canvas.loadFromJSON(JSON.parse(record.document_json));
      } catch {
        // 首次打开页面时没有历史画布，保持空白即可。
      }
      canvas.requestRenderAll();
      syncLayers(canvas);
      captureHistory(canvas);
    };
    void loadSaved();

    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      persistCanvasDocument(canvas, currentPage, canvasSize);
      canvas.dispose();
      canvasRef.current = null;
    };
  }, [currentPage, pageSource, setSelectedLayer, canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = toolMode === "select";
    canvas.defaultCursor = toolMode === "hand" ? "grab" : toolMode === "crop" ? "crosshair" : "default";
    canvas.getObjects().forEach((item) => {
      if (item.get("name") === "mask") return;
      const locked = lockedLayers.has(String(item.get("name")));
      item.set({ selectable: toolMode === "select" && !locked, evented: toolMode === "select" && !locked });
    });
    if (toolMode !== "select") canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [lockedLayers, toolMode]);

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
      object.set({ fontSize, opacity: opacity / 100, fontFamily, fontWeight, textAlign, fill: textColor, lineHeight, charSpacing });
      canvas.requestRenderAll();
      syncSelection(canvas);
    }
  }, [charSpacing, fontFamily, fontSize, fontWeight, lineHeight, opacity, textAlign, textColor]);

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

  const toggleLock = (id: string) => {
    setLockedLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      const locked = next.has(id);
      canvasRef.current?.getObjects().filter((item) => item.get("name") === id).forEach((item) => item.set({ selectable: !locked, evented: !locked }));
      canvasRef.current?.requestRenderAll();
      return next;
    });
  };

  const addTextLayer = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const id = `text-${createId()}`;
    const text = new Textbox("双击编辑文字", {
      name: id,
      left: Math.max(20, canvasSize.width * 0.16),
      top: Math.max(20, canvasSize.height * 0.14),
      width: Math.max(180, canvasSize.width * 0.68),
      fontSize,
      fontFamily,
      fontWeight,
      textAlign,
      fill: textColor,
      lineHeight,
      charSpacing,
      opacity: opacity / 100,
    });
    text.set("layerLabel", `文本 ${layerIds.length + 1}`);
    canvas.add(text);
    canvas.setActiveObject(text);
    setLayerIds((current) => [...current, id]);
    setVisibleLayers((current) => new Set(current).add(id));
    setSelectedLayer(id);
    syncSelection(canvas);
    captureHistory(canvas);
    persistCanvasDocument(canvas, currentPage, canvasSize);
  };

  const deleteSelectedLayer = () => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object || object.get("name") === "mask") return;
    const id = String(object.get("name"));
    canvas.remove(object);
    setLayerIds((current) => current.filter((item) => item !== id));
    setVisibleLayers((current) => { const next = new Set(current); next.delete(id); return next; });
    setLockedLayers((current) => { const next = new Set(current); next.delete(id); return next; });
    setSelectedLayer("");
    captureHistory(canvas);
    persistCanvasDocument(canvas, currentPage, canvasSize);
  };

  const updateActiveObject = (patch: Record<string, unknown>) => {
    const canvas = canvasRef.current;
    const object = canvas?.getActiveObject();
    if (!canvas || !object) return;
    object.set(patch);
    object.setCoords();
    canvas.requestRenderAll();
    syncSelection(canvas);
    captureHistory(canvas);
  };

  const alignActive = (align: "left" | "center" | "right") => {
    const object = canvasRef.current?.getActiveObject();
    if (!object) return;
    const left = align === "left" ? 0 : align === "right" ? canvasSize.width - object.getScaledWidth() : (canvasSize.width - object.getScaledWidth()) / 2;
    updateActiveObject({ left: Math.max(0, left) });
  };

  const restoreHistory = async (offset: -1 | 1) => {
    const canvas = canvasRef.current;
    const nextIndex = historyIndexRef.current + offset;
    if (!canvas || nextIndex < 0 || nextIndex >= historyRef.current.length) return;
    restoringHistory.current = true;
    historyIndexRef.current = nextIndex;
    await canvas.loadFromJSON(JSON.parse(historyRef.current[nextIndex]));
    canvas.requestRenderAll();
    syncLayers(canvas);
    restoringHistory.current = false;
    persistCanvasDocument(canvas, currentPage, canvasSize);
  };

  const fitCanvas = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = Math.floor(Math.min(100, Math.max(35, Math.min(rect.width / canvasSize.width, rect.height / canvasSize.height) * 94)));
    setZoom(next);
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
        size: ratioForCanvas(canvasSize),
        resolution: "1k",
        imageUrls: [editPayload.sourceDataUrl, editPayload.annotationDataUrl],
      });
      addTasks([{
        id: createId(),
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
        <div className="tool-group"><IconButton label="撤销" onClick={() => void restoreHistory(-1)}><Undo2 size={18} /></IconButton><IconButton label="重做" onClick={() => void restoreHistory(1)}><Redo2 size={18} /></IconButton></div>
        <div className="tool-group tool-group--modes">
          <IconButton label="选择" active={toolMode === "select"} onClick={() => { setToolMode("select"); setMaskMode(false); }}><MousePointer2 size={18} /><span>选择</span></IconButton>
          <IconButton label="裁剪" active={toolMode === "crop"} onClick={() => { setToolMode("crop"); setMaskMode(false); notify("裁剪模式：请在上方尺寸中选择目标尺寸或输入自定义尺寸"); }}><Crop size={18} /><span>裁剪</span></IconButton>
          <IconButton label="蒙版笔刷" active={maskMode} onClick={() => { setToolMode("mask"); toggleMaskMode(); }}><Paintbrush size={18} /><span>蒙版笔刷</span></IconButton>
          <IconButton label="抓手" active={toolMode === "hand"} onClick={() => { setToolMode("hand"); setMaskMode(false); }}><Hand size={18} /><span>抓手</span></IconButton>
          <IconButton label={segmenting ? "抠图中…" : "抠图"} onClick={() => void segmentSource()}><Scissors size={18} /><span>{segmenting ? "抠图中…" : "抠图"}</span></IconButton>
        </div>
        <div className="tool-fields"><label>X <input type="number" value={selectionBounds.x} onChange={(event) => updateActiveObject({ left: Number(event.target.value) })} /></label><label>Y <input type="number" value={selectionBounds.y} onChange={(event) => updateActiveObject({ top: Number(event.target.value) })} /></label><label>W <input type="number" value={selectionBounds.width} onChange={(event) => { const object = canvasRef.current?.getActiveObject(); if (object?.width) updateActiveObject({ scaleX: Number(event.target.value) / object.width }); }} /></label><label>H <input type="number" value={selectionBounds.height} onChange={(event) => { const object = canvasRef.current?.getActiveObject(); if (object?.height) updateActiveObject({ scaleY: Number(event.target.value) / object.height }); }} /></label><button aria-label="锁定所选图层" disabled={!selectedLayer} onClick={() => toggleLock(selectedLayer)}>{lockedLayers.has(selectedLayer) ? <Lock size={16} /> : <Unlock size={16} />}</button></div>
        <div className="tool-group"><IconButton label="左对齐" onClick={() => alignActive("left")}><AlignLeft size={18} /></IconButton><IconButton label="居中" onClick={() => alignActive("center")}><AlignCenter size={18} /></IconButton><IconButton label="右对齐" onClick={() => alignActive("right")}><AlignRight size={18} /></IconButton></div>
        <label className="canvas-size-select">尺寸 <select value={customSize ? "custom" : sizeLabel} onChange={(event) => { if (event.target.value === "custom") setCustomSize(true); else applyPresetSize(event.target.value); }}>{presetSizeOptions.map((preset) => <option key={preset}>{preset}</option>)}{<option value="custom">自定义…</option>}</select></label>
        <label className="zoom-select">缩放<select aria-label="画布缩放" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[35, 50, 72, 85, 100, 120].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
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
          {layerIds.map((id, index) => <button key={id} className={selectedLayer === id ? "is-active" : ""} onClick={() => selectLayer(id)}><TextCursorInput size={18} /><span>{`文本 ${index + 1}`}</span><i className={!visibleLayers.has(id) ? "is-hidden" : ""} onClick={(event) => { event.stopPropagation(); toggleLayer(id); }}><Eye size={16} /></i><i onClick={(event) => { event.stopPropagation(); toggleLock(id); }}>{lockedLayers.has(id) ? <Lock size={15} /> : <Unlock size={15} />}</i></button>)}
          {layerIds.length === 0 ? <p className="layer-list__empty">暂无叠加图层，可新建文本图层；背景图仍可导出。</p> : null}
        </div>
        <div className="layer-footer"><Button size="sm" icon={<Layers size={15} />} onClick={addTextLayer}>新建文本</Button><IconButton label="删除图层" disabled={!selectedLayer} onClick={deleteSelectedLayer}><Trash2 size={16} /></IconButton></div>
      </aside>

      <section className="canvas-workspace">
        <div className="canvas-ruler canvas-ruler--top">{rulerMarks(canvasSize.width).map((mark) => <span key={mark}>{mark}</span>)}</div>
        <div className="canvas-ruler canvas-ruler--left">{rulerMarks(canvasSize.height).map((mark) => <span key={mark}>{mark}</span>)}</div>
        <div className="canvas-stage" ref={stageRef}><div className={`canvas-host ${compare ? "is-comparing" : ""}`} style={{ backgroundImage: `url(${canvasBackground})`, aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, width: `${zoom}%` }}><canvas ref={canvasElement} style={{ visibility: compare ? "hidden" : "visible" }} /></div></div>
        <div className="canvas-controls">
          {customSize ? <label className="custom-size-fields">宽 <input type="number" min="1" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /> px 高 <input type="number" min="1" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /> px <button onClick={applyCustomSize}>应用</button></label> : null}
          <Button size="sm" icon={<Scan size={15} />} onClick={fitCanvas}>适合画布</Button><ZoomOut size={16} /><input type="range" min="35" max="120" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><ZoomIn size={16} /><label title="显示不含叠加图层的原始背景">对比 <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /></label>
        </div>
      </section>

      <aside className="canvas-inspector">
        <div className="inspector-tabs"><button className={inspectorTab === "properties" ? "is-active" : ""} onClick={() => setInspectorTab("properties")}>属性</button><button className={inspectorTab === "ai" ? "is-active" : ""} onClick={() => setInspectorTab("ai")}>AI 局部编辑</button></div>
        <div className="canvas-inspector__body">
          {inspectorTab === "properties" ? <>
          <section className="property-section">
            <header>文本 <ChevronDown size={15} /></header>
            <select className="field-select" value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}><option>HarmonyOS Sans SC</option><option>Microsoft YaHei</option><option>Arial</option></select>
            <div className="field-row"><select className="field-select" value={fontWeight} onChange={(event) => setFontWeight(event.target.value as "normal" | "bold")}><option value="normal">常规</option><option value="bold">粗体</option></select><label><input type="number" min="8" max="400" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /> px</label></div>
            <label className="color-field"><input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} />{textColor.toUpperCase()}</label>
            <div className="field-row"><label>行高 <input type="number" min="0.5" max="3" step="0.1" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /></label><label>字距 <input type="number" min="-200" max="800" value={charSpacing} onChange={(event) => setCharSpacing(Number(event.target.value))} /></label></div>
            <div className="alignment-row"><button className={textAlign === "left" ? "is-active" : ""} onClick={() => setTextAlign("left")}><AlignLeft size={18} /></button><button className={textAlign === "center" ? "is-active" : ""} onClick={() => setTextAlign("center")}><AlignCenter size={18} /></button><button className={textAlign === "right" ? "is-active" : ""} onClick={() => setTextAlign("right")}><AlignRight size={18} /></button></div>
            <label className="opacity-field">不透明度 <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><b>{opacity}%</b></label>
          </section>
          <button className={`property-collapse ${strokeOpen ? "is-open" : ""}`} onClick={() => setStrokeOpen((value) => !value)}>描边与阴影 <ChevronDown size={15} /></button>
          {strokeOpen ? <section className="property-section property-section--compact"><label className="color-field">描边 <input type="color" onChange={(event) => updateActiveObject({ stroke: event.target.value, strokeWidth: 2 })} /></label><Button size="sm" onClick={() => updateActiveObject({ shadow: "0 8px 24px rgba(0,0,0,.35)" })}>添加柔和阴影</Button></section> : null}
          <button className={`property-collapse ${positionOpen ? "is-open" : ""}`} onClick={() => setPositionOpen((value) => !value)}>位置与尺寸 <ChevronDown size={15} /></button>
          {positionOpen ? <section className="property-section property-section--compact"><div className="field-row"><label>X <input type="number" value={selectionBounds.x} onChange={(event) => updateActiveObject({ left: Number(event.target.value) })} /></label><label>Y <input type="number" value={selectionBounds.y} onChange={(event) => updateActiveObject({ top: Number(event.target.value) })} /></label></div><Button size="sm" onClick={() => alignActive("center")}>水平居中</Button></section> : null}
          </> : null}
          {inspectorTab === "ai" ? (
          <section className="ai-edit-section">
            <header>AI 局部编辑 <ChevronDown size={15} /></header>
            <div className="mask-row"><span>蒙版区域</span><div className="mask-preview">{maskPreviewUrl ? <img src={maskPreviewUrl} alt="蒙版预览" /> : <><i /><i /></>}</div><IconButton label={maskMode ? "退出蒙版" : "编辑蒙版"} active={maskMode} onClick={toggleMaskMode}><Paintbrush size={16} /></IconButton>{maskPreviewUrl ? <IconButton label="清除蒙版" onClick={clearMask}><Trash2 size={16} /></IconButton> : null}</div>
            <label>编辑指令<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /><small>{prompt.length}/200</small></label>
            <Button variant="primary" className="full-width" onClick={() => void openEditConfirm()}>{confirmingEdit ? "正在准备…" : "生成局部修改"}</Button>
          </section>
          ) : null}
        </div>
      </aside>

      <footer className="editor-status"><span>{sizeLabel} px</span><span>RGB / sRGB</span><span>● 自动保存已开启</span><span>● 最近保存 {savedAt}</span><span>{memoryLabel}</span></footer>
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

const ratioForCanvas = ({ width, height }: CanvasSize) => {
  const ratios = [
    ["1:1", 1], ["3:2", 1.5], ["2:3", 2 / 3], ["4:3", 4 / 3], ["3:4", 3 / 4],
    ["5:4", 1.25], ["4:5", 0.8], ["16:9", 16 / 9], ["9:16", 9 / 16], ["2:1", 2], ["1:2", 0.5],
  ] as const;
  const aspect = width / Math.max(1, height);
  return ratios.reduce((best, candidate) => Math.abs(candidate[1] - aspect) < Math.abs(best[1] - aspect) ? candidate : best)[0];
};
