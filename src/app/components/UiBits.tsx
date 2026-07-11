"use client";

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
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackClassName: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className={fallbackClassName} aria-hidden="true" />;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
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
      <img src={emptyStateArtPaths[artKey]} alt="" loading="lazy" />
      <span>{text}</span>
    </div>
  );
}

export const MoneyInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}>(function MoneyInput({
  value,
  onChange,
  disabled = false,
  placeholder,
}, ref) {
  return (
    <span className="money-input">
      <span aria-hidden="true">£</span>
      <input
        ref={ref}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </span>
  );
});
