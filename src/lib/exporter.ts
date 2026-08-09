import { writePsd } from "ag-psd";
import type { Canvas } from "fabric";
import JSZip from "jszip";
import { hasTauriRuntime } from "./desktop";
import { planPsdLayers } from "./psdLayers";

export type ExportFormat = "png" | "jpg" | "webp" | "psd" | "zip" | "long";

export interface ExportDimensions {
  width: number;
  height: number;
}

export const DEFAULT_EXPORT_DIMENSIONS: ExportDimensions = { width: 1000, height: 1000 };

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("读取画布背景失败"));
  image.src = src;
});

const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const renderLayers = async (fabricCanvas: Canvas, backgroundUrl: string, { width, height }: ExportDimensions) => {
  const background = makeCanvas(width, height);
  const backgroundContext = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundContext) throw new Error("无法初始化导出画布");
  backgroundContext.drawImage(await loadImage(backgroundUrl), 0, 0, width, height);

  // 蒙版笔迹是局部编辑的标注，不应出现在成品导出中：渲染叠加层时临时隐藏，完事恢复
  const maskObjects = fabricCanvas.getObjects().filter((item) => item.get("name") === "mask" && item.visible !== false);
  maskObjects.forEach((item) => item.set({ visible: false }));

  const overlay = makeCanvas(width, height);
  const overlayContext = overlay.getContext("2d", { willReadFrequently: true });
  if (!overlayContext) throw new Error("无法初始化图层画布");
  try {
    overlayContext.drawImage(fabricCanvas.toCanvasElement(), 0, 0, width, height);
  } finally {
    maskObjects.forEach((item) => item.set({ visible: true }));
  }

  const composite = makeCanvas(width, height);
  const compositeContext = composite.getContext("2d", { willReadFrequently: true });
  if (!compositeContext) throw new Error("无法初始化合成画布");
  compositeContext.drawImage(background, 0, 0);
  compositeContext.drawImage(overlay, 0, 0);
  return { background, overlay, composite };
};

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("编码导出图片失败")), type, quality);
});

/**
 * 语义分层 PSD 的图层构建。
 * 层序自顶向下（ag-psd children[0] = 最顶层）：画布对象按语义分组逐层
 * 渲染（对象按画布 z 序），背景固定为最底层。与合成图的视觉效果一致。
 */
const buildSemanticPsdLayers = async (fabricCanvas: Canvas, backgroundUrl: string, { width, height }: ExportDimensions) => {
  const background = makeCanvas(width, height);
  const backgroundContext = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundContext) throw new Error("无法初始化导出画布");
  backgroundContext.drawImage(await loadImage(backgroundUrl), 0, 0, width, height);

  const objects = fabricCanvas.getObjects();
  const plan = planPsdLayers(objects);
  const scaleX = width / fabricCanvas.getWidth();
  const scaleY = height / fabricCanvas.getHeight();

  const children: { name: string; imageData: ImageData }[] = [];
  for (const layer of plan) {
    const layerCanvas = makeCanvas(width, height);
    const ctx = layerCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法初始化图层画布");
    ctx.scale(scaleX, scaleY);
    // 组内对象按画布 z 序（下标升序 = 从底到顶）渲染
    [...layer.indices].sort((a, b) => a - b).forEach((index) => objects[index].render(ctx));
    children.push({ name: layer.label, imageData: ctx.getImageData(0, 0, width, height) });
  }
  children.push({ name: "商品背景", imageData: backgroundContext.getImageData(0, 0, width, height) });
  return children;
};

const saveBytes = async (bytes: Uint8Array, filename: string, mimeType: string) => {
  if (hasTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const extension = filename.split(".").pop() ?? "bin";
    const target = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!target) return false;
    await writeFile(target, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
};

export async function exportCanvasDocument(
  fabricCanvas: Canvas,
  backgroundUrl: string,
  format: ExportFormat,
  dimensions: ExportDimensions = DEFAULT_EXPORT_DIMENSIONS,
) {
  const { width, height } = dimensions;
  if (format === "psd") {
    const children = await buildSemanticPsdLayers(fabricCanvas, backgroundUrl, dimensions);
    const psd = writePsd({ width, height, children });
    return saveBytes(new Uint8Array(psd), "ListingForge-商品海报.psd", "image/vnd.adobe.photoshop");
  }

  const { composite } = await renderLayers(fabricCanvas, backgroundUrl, dimensions);

  const png = await canvasBlob(composite, "image/png");
  if (format === "zip") {
    const zip = new JSZip();
    zip.file("preview.png", png);
    zip.file("canvas.json", JSON.stringify(fabricCanvas.toJSON(), null, 2));
    zip.file("manifest.json", JSON.stringify({ schemaVersion: 1, width, height, createdAt: new Date().toISOString() }, null, 2));
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return saveBytes(archive, "ListingForge-工程包.listingforge", "application/zip");
  }
  if (format === "jpg") {
    const blob = await canvasBlob(composite, "image/jpeg", 0.94);
    return saveBytes(new Uint8Array(await blob.arrayBuffer()), "ListingForge-商品海报.jpg", "image/jpeg");
  }
  if (format === "webp") {
    const blob = await canvasBlob(composite, "image/webp", 0.94);
    return saveBytes(new Uint8Array(await blob.arrayBuffer()), "ListingForge-商品海报.webp", "image/webp");
  }
  const filename = format === "long" ? "ListingForge-详情长图.png" : "ListingForge-商品海报.png";
  return saveBytes(new Uint8Array(await png.arrayBuffer()), filename, "image/png");
}
