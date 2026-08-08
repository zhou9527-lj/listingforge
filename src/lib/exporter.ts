import { writePsd } from "ag-psd";
import type { Canvas } from "fabric";
import JSZip from "jszip";
import { hasTauriRuntime } from "./desktop";

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

  const overlay = makeCanvas(width, height);
  const overlayContext = overlay.getContext("2d", { willReadFrequently: true });
  if (!overlayContext) throw new Error("无法初始化图层画布");
  overlayContext.drawImage(fabricCanvas.toCanvasElement(), 0, 0, width, height);

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
  const { background, overlay, composite } = await renderLayers(fabricCanvas, backgroundUrl, dimensions);
  if (format === "psd") {
    const backgroundContext = background.getContext("2d")!;
    const overlayContext = overlay.getContext("2d")!;
    const psd = writePsd({
      width,
      height,
      children: [
        { name: "可编辑文字与装饰", imageData: overlayContext.getImageData(0, 0, width, height) },
        { name: "商品背景", imageData: backgroundContext.getImageData(0, 0, width, height) },
      ],
    });
    return saveBytes(new Uint8Array(psd), "ListingForge-商品海报.psd", "image/vnd.adobe.photoshop");
  }

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
