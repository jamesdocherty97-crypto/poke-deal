export const PHOTO_MAX_EDGE_PX = 1600;
export const PHOTO_MIN_EBAY_EDGE_PX = 500;
export const PHOTO_JPEG_QUALITY = 0.85;
export const SCAN_IMAGE_MAX_EDGE_PX = 1024;
export const SCAN_IMAGE_JPEG_QUALITY = 0.7;

export interface PhotoDimensions {
  width: number;
  height: number;
}

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export function fitPhotoDimensions(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE_PX,
): PhotoDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Photo dimensions must be positive.");
  }
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) {
    throw new Error("Maximum photo edge must be positive.");
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function inventoryPhotoUploadPath(itemId: string, index: number, now = Date.now()): string {
  const safeItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeIndex = Math.max(0, Math.floor(index));
  return `inventory/${safeItemId}/${now}-${safeIndex}.jpg`;
}

export async function compressPhotoForUpload(file: File): Promise<CompressedPhoto> {
  const compressed = await compressImage(file, PHOTO_MAX_EDGE_PX, PHOTO_JPEG_QUALITY);
  if (Math.max(compressed.width, compressed.height) < PHOTO_MIN_EBAY_EDGE_PX) {
    throw new Error("Photo is too small for eBay. Use an image at least 500px on the longest side.");
  }
  return compressed;
}

export async function compressPhotoForScan(file: File | Blob): Promise<CompressedPhoto> {
  return compressImage(file, SCAN_IMAGE_MAX_EDGE_PX, SCAN_IMAGE_JPEG_QUALITY);
}

async function compressImage(file: File | Blob, maxEdge: number, quality: number): Promise<CompressedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitPhotoDimensions(bitmap.width, bitmap.height, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not prepare photo.");
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((output) => {
      if (output) resolve(output);
      else reject(new Error("Could not compress photo."));
    }, "image/jpeg", quality);
  });

  return { blob, width, height };
}
