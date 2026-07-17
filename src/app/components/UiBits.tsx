"use client";

import Image from "next/image";
import { forwardRef, useState } from "react";

export function Metric({
  label,
  value,
  tone,
  loading = false,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
  loading?: boolean;
}) {
  return (
    <div className={`metric ${tone ?? ""} ${loading ? "loading" : ""}`} aria-busy={loading ? "true" : undefined}>
      <span>{label}</span>
      <strong>{loading ? <i aria-hidden="true" /> : value}</strong>
    </div>
  );
}

export function CardImage({
  src,
  alt,
  className,
  fallbackClassName,
  eager = false,
}: {
  src?: string | readonly string[] | null;
  alt: string;
  className?: string;
  fallbackClassName: string;
  eager?: boolean;
}) {
  const sources = (Array.isArray(src) ? src : [src])
    .filter((value): value is string => Boolean(value))
    .map(normalizeCardImageUrl);
  const sourceKey = sources.join("|");
  const [failed, setFailed] = useState<{ key: string; index: number }>({ key: sourceKey, index: 0 });
  const index = failed.key === sourceKey ? failed.index : 0;
  const activeSrc = sources[index];
  if (!activeSrc) return <span className={fallbackClassName} aria-hidden="true" />;
  const dimensions = imageDimensions(activeSrc);
  const sharedProps = {
    className,
    src: activeSrc,
    alt,
    width: dimensions.width,
    height: dimensions.height,
    loading: eager ? "eager" as const : "lazy" as const,
    fetchPriority: eager ? "high" as const : "auto" as const,
    decoding: "async" as const,
    onError: () => setFailed({ key: sourceKey, index: index + 1 }),
  };
  if (canOptimizeImage(activeSrc)) {
    return (
      <Image
        {...sharedProps}
        priority={eager}
        sizes={cardImageSizes(className, eager)}
      />
    );
  }
  return (
    <img
      {...sharedProps}
    />
  );
}

const optimizableImageHosts = new Set([
  "images.pokemontcg.io",
  "assets.tcgdex.net",
  "cdn.poketrace.com",
  "images.scrydex.com",
  "i.ebayimg.com",
  "d1htnxwo4o0jhw.cloudfront.net",
  "tcgplayer-cdn.tcgplayer.com",
]);

function normalizeCardImageUrl(src: string): string {
  try {
    const url = new URL(src);
    if (url.hostname === "images.pokemontcg.io" && url.pathname.endsWith("_hires.png")) {
      url.pathname = url.pathname.replace(/_hires\.png$/, ".png");
      return url.toString();
    }
  } catch {
    // Relative app assets do not need URL parsing.
  }
  return src;
}

function canOptimizeImage(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const hostname = new URL(src).hostname;
    return optimizableImageHosts.has(hostname) || hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function imageDimensions(src: string): { width: number; height: number } {
  if (src.includes("/brand/") || src.includes("/visual/")) return { width: 512, height: 512 };
  return { width: 245, height: 342 };
}

function cardImageSizes(className: string | undefined, eager: boolean): string {
  if (className?.includes("mini-card-art")) return "110px";
  if (className?.includes("card-thumb")) return "(max-width: 767px) 80px, 124px";
  if (className?.includes("buy-stage-card")) return "(max-width: 767px) 148px, 210px";
  if (className?.includes("deal-sleeve-card")) return "160px";
  if (className?.includes("suggestion-card-art") || className?.includes("quick-card-art")) return "48px";
  return eager ? "(max-width: 767px) 96px, 180px" : "128px";
}

export type EmptyStateArt = "stock" | "sales" | "watches" | "alerts" | "session" | "search";

const emptyStateArtPaths: Record<EmptyStateArt, string> = {
  stock: "/visual/empty/stock.webp",
  sales: "/visual/empty/sales.webp",
  watches: "/visual/empty/watches.webp",
  alerts: "/visual/empty/alerts.webp",
  session: "/visual/empty/session.webp",
  search: "/visual/empty/search.webp",
};

function inferEmptyStateArt(text: string): EmptyStateArt {
  const lower = text.toLowerCase();
  if (lower.includes("watch")) return "watches";
  if (lower.includes("alert") || lower.includes("automation") || lower.includes("message")) return "alerts";
  if (lower.includes("sale") || lower.includes("channel") || lower.includes("cost")) return "sales";
  if (lower.includes("session") || lower.includes("lot")) return "session";
  if (lower.includes("matching") || lower.includes("search") || lower.includes("clear")) return "search";
  return "stock";
}

export function EmptyState({ text, art }: { text: string; art?: EmptyStateArt }) {
  const artKey = art ?? inferEmptyStateArt(text);
  return (
    <div className={`empty-state illustrated art-${artKey}`}>
      <img src={emptyStateArtPaths[artKey]} alt="" width={512} height={512} loading="lazy" decoding="async" />
      <span>{text}</span>
    </div>
  );
}

export function WorkspaceSkeleton({ label = "Loading workspace", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="workspace-skeleton" aria-busy="true" aria-label={label}>
      <div className="skeleton-hero" />
      {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index} />)}
    </div>
  );
}

export const MoneyInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
}>(function MoneyInput({
  value,
  onChange,
  disabled = false,
  placeholder,
  name,
  autoComplete,
}, ref) {
  return (
    <span className="money-input">
      <span aria-hidden="true">£</span>
      <input
        ref={ref}
        name={name}
        autoComplete={autoComplete}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </span>
  );
});
