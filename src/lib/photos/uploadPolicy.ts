export const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;
export const ALLOWED_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function inventoryPhotoUploadPrefix(itemId: string): string {
  return `inventory/${itemId}/`;
}

export function validateInventoryPhotoUploadPath(itemId: string, pathname: string): void {
  if (!pathname.startsWith(inventoryPhotoUploadPrefix(itemId))) {
    throw new Error("Photo path does not match this inventory item.");
  }
}

/** True only for inventory blobs owned by the configured Vercel Blob store. */
export function isManagedInventoryPhotoBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.endsWith(".blob.vercel-storage.com") &&
      url.pathname.startsWith("/inventory/");
  } catch {
    return false;
  }
}
