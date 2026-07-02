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
  return <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

export function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
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
