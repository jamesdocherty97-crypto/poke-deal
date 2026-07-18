"use client";

import { useState } from "react";
import { orderListingPhotos } from "@/lib/photos/listingPhotoPolicy";
import { CardImage } from "./UiBits";

type CardPhoto = {
  id: string;
  url: string;
  role?: "FRONT" | "BACK" | "SLAB" | "EXTRA";
  origin?: "REAL" | "SCAN" | "CATALOG";
};

type PhotoItem = {
  id: string;
  grade?: string;
  status?: string;
  card?: { imageUrl?: string | null };
  photos?: CardPhoto[];
};

export function InventoryPhotoStrip({
  item,
  controls = false,
  busy = false,
  onMovePhoto,
  onDeletePhoto,
}: {
  item: PhotoItem | null | undefined;
  controls?: boolean;
  busy?: boolean;
  onMovePhoto?: (item: PhotoItem, photoId: string, direction: -1 | 1) => void;
  onDeletePhoto?: (item: PhotoItem, photoId: string) => void;
}) {
  const photos = orderListingPhotos(item?.photos ?? []);
  if (!item || photos.length === 0) return null;

  return (
    <div className="inventory-photo-strip" aria-label="Item photos">
      {photos.map((photo, index) => (
        <div className="inventory-photo-chip" key={photo.id}>
          <CardImage
            src={photo.url}
            className="inventory-photo-thumb"
            fallbackClassName="inventory-photo-thumb blank"
            alt={index === 0 ? "Primary listing photo" : `Listing photo ${index + 1}`}
          />
          <span>
            {index === 0 ? "Primary" : photo.role?.toLowerCase() ?? `#${index + 1}`}
            {photo.origin === "CATALOG" ? " · stock" : ""}
            {photo.origin === "SCAN" ? " · scan" : ""}
          </span>
          {controls && (
            <div className="inventory-photo-actions" aria-label={`Photo ${index + 1} actions`}>
              <button
                type="button"
                onClick={() => onMovePhoto?.(item, photo.id, -1)}
                disabled={busy || index === 0}
              >
                Up
              </button>
              <button
                type="button"
                onClick={() => onMovePhoto?.(item, photo.id, 1)}
                disabled={busy || index === photos.length - 1}
              >
                Down
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => onDeletePhoto?.(item, photo.id)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function InventoryPhotoTools({
  item,
  busy,
  onPhotos,
  onPhotoUrl,
  onCatalogArt,
  onMovePhoto,
  onDeletePhoto,
}: {
  item: PhotoItem;
  busy: string | null;
  onPhotos: (item: PhotoItem, files: FileList | File[]) => void;
  onPhotoUrl: (item: PhotoItem, url: string) => void;
  onCatalogArt?: (item: PhotoItem) => void;
  onMovePhoto: (item: PhotoItem, photoId: string, direction: -1 | 1) => void;
  onDeletePhoto: (item: PhotoItem, photoId: string) => void;
}) {
  const [manualUrl, setManualUrl] = useState("");
  const photoCount = item.photos?.length ?? 0;
  const isBusy = busy === `photo-${item.id}`;
  const isGraded = item.grade != null && item.grade !== "RAW";
  const hasCatalogArt = Boolean(item.photos?.some((photo) => photo.origin === "CATALOG"));
  const canUseCatalogArt = Boolean(!isGraded && item.card?.imageUrl && !hasCatalogArt);

  return (
    <div className="inventory-photo-tools">
      <InventoryPhotoStrip
        item={item}
        controls
        busy={isBusy}
        onMovePhoto={onMovePhoto}
        onDeletePhoto={onDeletePhoto}
      />
      {isGraded && item.status !== "SOLD" && (
        <p className="photo-nudge">include a clear cert photo</p>
      )}
      {item.status !== "SOLD" && (
        <div className="photo-tool-actions">
          <label className={`row-file-action ${isBusy ? "disabled" : ""}`}>
            {isBusy ? "Uploading…" : photoCount > 0 ? "Add photos" : "Photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={isBusy}
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files) onPhotos(item, files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {!isGraded && (
            <button
              className="catalog-photo-action"
              type="button"
              onClick={() => onCatalogArt?.(item)}
              disabled={isBusy || !canUseCatalogArt || !onCatalogArt}
              title={!item.card?.imageUrl ? "No catalog image is saved for this card yet." : undefined}
            >
              {hasCatalogArt ? "Catalog art added" : "Use catalog art"}
            </button>
          )}
          <details className="manual-photo-url">
            <summary>Image URL</summary>
            <div>
              <input
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                name="inventory-photo-url"
                type="url"
                inputMode="url"
                placeholder="https://example.com/photo…"
                disabled={isBusy}
              />
              <button
                type="button"
                onClick={() => {
                  onPhotoUrl(item, manualUrl);
                  setManualUrl("");
                }}
                disabled={isBusy || manualUrl.trim().length === 0}
              >
                Add URL
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
