const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_BYTES = 60 * 1024 * 1024;
export const MAX_REFERENCE_COUNT = 20;
export const MIN_IMAGE_EDGE = 256;
export const MAX_IMAGE_EDGE = 12_000;

export function validateImageFileBasics(file: File, maxBytes = MAX_IMAGE_BYTES) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error(`${file.name} 不是支持的 PNG、JPG 或 WebP 图片`);
  }
  if (file.size > maxBytes) {
    throw new Error(`${file.name} 超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MB 上限`);
  }
}

const readImageDimensions = async (file: File) => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`${file.name} 无法读取或文件已损坏`));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

export async function validateImageFiles(files: File[], otherBytes = 0, otherCount = 0) {
  const totalBytes = otherBytes + files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_REFERENCE_BYTES) {
    throw new Error(`本次所有参考图总计不能超过 ${MAX_REFERENCE_BYTES / 1024 / 1024} MB`);
  }

  const totalCount = otherCount + files.length;
  if (totalCount > MAX_REFERENCE_COUNT) {
    throw new Error(`本次最多引用 ${MAX_REFERENCE_COUNT} 张参考图，当前已有 ${otherCount} 张`);
  }

  for (const file of files) {
    validateImageFileBasics(file);
    const { width, height } = await readImageDimensions(file);
    if (Math.min(width, height) < MIN_IMAGE_EDGE || Math.max(width, height) > MAX_IMAGE_EDGE) {
      throw new Error(`${file.name} 尺寸需在 ${MIN_IMAGE_EDGE}–${MAX_IMAGE_EDGE} 像素之间`);
    }
  }
}
