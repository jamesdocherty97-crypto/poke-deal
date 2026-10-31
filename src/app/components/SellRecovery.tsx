"use client";

import { forwardRef } from "react";
import type { RecoveryActionId, RecoveryCard } from "@/lib/sell/phoneRecovery";

export const SellRecoveryCard = forwardRef<HTMLElement, {
  card: RecoveryCard;
  note?: string | null;
  busy?: boolean;
  onAction: (card: RecoveryCard, id: RecoveryActionId) => void;
}>(function SellRecoveryCard({
  card,
  note = null,
  busy = false,
  onAction,
}, ref) {
  return (
    <section ref={ref} className={`sell-recovery sell-recovery-${card.kind}`} aria-label={card.title} data-recovery={card.kind}>
      <p className="sell-recovery-kicker">{card.kicker}</p>
      <h3>{card.title}</h3>
      {card.message ? <p>{card.message}</p> : null}
      {note ? <p className="sell-recovery-note">{note}</p> : null}
      <div className="sell-recovery-actions">
        {card.actions.map((action, index) => {
          const pending = busy && (action.id === "retry-price" || action.id === "retake" || action.id === "upload");
          const label = pending && action.id === "retry-price" ? "Trying the price again" : action.label;
          return (
            <button
              key={action.id}
              type="button"
              className={index === 0 ? "primary-action" : undefined}
              aria-label={label}
              aria-busy={pending ? "true" : undefined}
              disabled={pending}
              onClick={() => onAction(card, action.id)}
            >
              <strong>{label}</strong>
              <small>{action.detail}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
});
