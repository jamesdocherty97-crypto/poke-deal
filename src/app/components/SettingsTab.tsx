"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  DEFAULT_DEAL_CALC_SETTINGS,
  normalizeDealCalcSettings,
  type DealCalcSettings,
} from "@/lib/dealer/dealCalc";
import {
  DEFAULT_LISTING_COPY_SETTINGS,
  type ListingCopySettings,
} from "@/lib/dealer/listingPack";
import { MoneyInput } from "./UiBits";

export function SettingsTab({
  dealSettings,
  setDealSettings,
  listingCopySettings,
  setListingCopySettings,
  sources,
  checkedAt,
  checking,
  onDeepCheck,
}: {
  dealSettings: DealCalcSettings;
  setDealSettings: Dispatch<SetStateAction<DealCalcSettings>>;
  listingCopySettings: ListingCopySettings;
  setListingCopySettings: Dispatch<SetStateAction<ListingCopySettings>>;
  sources: Array<{
    id: string;
    label: string;
    role: string;
    status: "ready" | "public" | "fixture" | "missing" | "building" | "problem" | "info";
    setupHint?: string;
    deepCheck?: { status: "ok" | "fail" | "skipped"; latencyMs: number; detail: string; checkedAt: string };
  }>;
  checkedAt?: string | null;
  checking: boolean;
  onDeepCheck: () => void;
}) {
  const liveSourceCount = sources.filter((source) => source.deepCheck?.status === "ok").length;
  const attentionSourceCount = sources.filter(
    (source) => source.deepCheck?.status === "fail" || source.status === "missing" || source.status === "problem",
  ).length;
  const [showAllProviders, setShowAllProviders] = useState(false);
  const providerNeedsAttention = (source: (typeof sources)[number]) =>
    source.deepCheck?.status === "fail" ||
    source.status === "missing" ||
    source.status === "problem" ||
    source.status === "info";
  const attentionProviders = sources.filter(providerNeedsAttention);
  const visibleProviders = showAllProviders || attentionProviders.length === 0 ? sources : attentionProviders;

  return (
    <section className="workspace settings-workspace">
      <header className="workspace-masthead settings-masthead">
        <div className="workspace-masthead-copy">
          <p className="workspace-kicker">Trainer configuration</p>
          <h2>Keep the trading desk ready for the next deal.</h2>
          <p>
            Check live data first, then tune the rules that shape every offer, listing and grading decision.
          </p>
          <p className="settings-save-note" role="status">Changes save automatically on this device.</p>
        </div>
        <dl className="settings-health-summary" aria-label="Provider status summary">
          <div>
            <dt>Data sources</dt>
            <dd>{sources.length}</dd>
          </div>
          <div>
            <dt>Live responses</dt>
            <dd>{liveSourceCount}</dd>
          </div>
          <div className={attentionSourceCount > 0 ? "needs-attention" : undefined}>
            <dt>Needs attention</dt>
            <dd>{attentionSourceCount}</dd>
          </div>
        </dl>
      </header>

      <div className="settings-shell">
        <aside className="settings-index">
          <div className="settings-index-heading">
            <span>Setup map</span>
            <strong>Trading desk</strong>
          </div>
          <nav aria-label="Setup sections">
            <a href="#provider-health">
              <span>Provider health</span>
              <small>Connections and live data</small>
            </a>
            <a href="#listing-copy">
              <span>Listing copy</span>
              <small>Buyer-facing terms</small>
            </a>
            <a href="#deal-policy">
              <span>Deal policy</span>
              <small>Margins and selling costs</small>
            </a>
            <a href="#risk-delivery">
              <span>Risk &amp; delivery</span>
              <small>Postage and confidence</small>
            </a>
            <a href="#grading-policy">
              <span>Grading EV</span>
              <small>Costs and outcome odds</small>
            </a>
          </nav>
        </aside>

        <div className="settings-sections">
          <section
            className="panel settings-section provider-health-panel"
            id="provider-health"
            aria-labelledby="provider-health-title"
          >
            <div className="settings-section-header">
              <div className="settings-section-title">
                <span className="settings-section-kicker">Connections</span>
                <h2 id="provider-health-title">Provider health</h2>
                <p>Confirm which integrations are producing usable dealer data before relying on a comp.</p>
              </div>
              <button type="button" onClick={onDeepCheck} disabled={checking}>
                {checking ? "Checking…" : "Run live check"}
              </button>
            </div>
            <p className="provider-check-age hint" aria-live="polite">
              {checkedAt ? `Last live check ${formatAge(checkedAt)}.` : "No live provider check has been run yet."}
            </p>
            <div className="provider-status-table-wrap">
              <table className="provider-status-table">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Role</th>
                    <th scope="col">Live signal</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProviders.map((source, sourceIndex) => {
                    const check = source.deepCheck;
                    const state =
                      check?.status ??
                      (source.status === "ready" || source.status === "public" ? "configured" : source.status);
                    const statusLabel = check
                      ? check.status === "ok"
                        ? "Live data"
                        : check.status === "fail"
                          ? "Failed"
                          : "Skipped"
                      : state;
                    return (
                      <tr className={`provider-status state-${state}`} key={`${source.id}-${sourceIndex}`}>
                        <th scope="row">
                          <strong>{source.label}</strong>
                          {source.setupHint && <small>{source.setupHint}</small>}
                        </th>
                        <td data-label="Role">{source.role}</td>
                        <td data-label="Live signal" className={check ? undefined : "provider-cell-quiet"}>
                          {check?.detail ?? "—"}
                        </td>
                        <td data-label="Status">
                          <span className="provider-status-badge">{statusLabel}</span>
                          {check && <small>{`${check.latencyMs}ms · ${formatAge(check.checkedAt)}`}</small>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {attentionProviders.length > 0 && (
              <button
                className="ghost-button provider-table-toggle"
                type="button"
                aria-expanded={showAllProviders}
                onClick={() => setShowAllProviders((current) => !current)}
              >
                {showAllProviders
                  ? `Show only providers needing attention (${attentionProviders.length})`
                  : `Show all ${sources.length} providers`}
              </button>
            )}
          </section>

          <section className="panel settings-section" id="listing-copy" aria-labelledby="listing-copy-title">
            <div className="settings-section-header">
              <div className="settings-section-title">
                <span className="settings-section-kicker">Marketplace voice</span>
                <h2 id="listing-copy-title">Listing copy</h2>
                <p>Buyer-facing terms reused in eBay, Cardmarket, Vinted and CSV listing drafts.</p>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (window.confirm("Reset listing copy to the defaults saved with Poke Deal?")) {
                    setListingCopySettings(DEFAULT_LISTING_COPY_SETTINGS);
                  }
                }}
              >
                Reset copy
              </button>
            </div>
            <div className="settings-copy-fields">
              <label>
                Postage terms
                <textarea
                  name="listing-postage-terms"
                  autoComplete="off"
                  rows={4}
                  value={listingCopySettings.postageTerms}
                  onChange={(event) =>
                    setListingCopySettings((settings) => ({
                      ...settings,
                      postageTerms: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Returns line
                <textarea
                  name="listing-returns-line"
                  autoComplete="off"
                  rows={3}
                  value={listingCopySettings.returnsLine}
                  onChange={(event) =>
                    setListingCopySettings((settings) => ({
                      ...settings,
                      returnsLine: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="panel settings-section" id="deal-policy" aria-labelledby="deal-policy-title">
            <div className="settings-section-header">
              <div className="settings-section-title">
                <span className="settings-section-kicker">Buying rules</span>
                <h2 id="deal-policy-title">Deal policy</h2>
                <p>Set the margin, trade premium and selling costs behind every maximum offer.</p>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (window.confirm("Reset every deal, fee, delivery, and grading rule to its default?")) {
                    setDealSettings(DEFAULT_DEAL_CALC_SETTINGS);
                  }
                }}
              >
                Reset deal rules
              </button>
            </div>
            <div className="form-grid settings-field-grid settings-field-grid-featured">
              <label>
                Target margin %
                <input
                  name="target-margin-percent"
                  autoComplete="off"
                  inputMode="decimal"
                  value={dealSettings.marginTargetPct}
                  onChange={(event) =>
                    setDealSettings((settings) =>
                      normalizeDealCalcSettings({
                        ...settings,
                        marginTargetPct: numberFromInput(event.target.value, settings.marginTargetPct),
                      }),
                    )
                  }
                />
              </label>
              <label>
                Trade premium %
                <input
                  name="trade-premium-percent"
                  autoComplete="off"
                  inputMode="decimal"
                  value={dealSettings.tradePremiumPct}
                  onChange={(event) =>
                    setDealSettings((settings) =>
                      normalizeDealCalcSettings({
                        ...settings,
                        tradePremiumPct: numberFromInput(event.target.value, settings.tradePremiumPct),
                      }),
                    )
                  }
                />
              </label>
            </div>
            <div className="settings-subsection">
              <div className="settings-subsection-heading">
                <h3>Selling costs</h3>
                <p>Fees and materials deducted when calculating what the deal can return.</p>
              </div>
              <div className="settings-toggle-row">
                <label>
                  <input
                    name="promoted-listing-enabled"
                    type="checkbox"
                    checked={dealSettings.fees.promotedEnabled}
                    onChange={(event) =>
                      setDealSettings((settings) =>
                        normalizeDealCalcSettings({
                          ...settings,
                          fees: { ...settings.fees, promotedEnabled: event.target.checked },
                        }),
                      )
                    }
                  />
                  Include promoted listing fee
                </label>
              </div>
              <div className="form-grid settings-field-grid">
                <label>
                  eBay final value %
                  <input
                    name="ebay-final-value-percent"
                    autoComplete="off"
                    inputMode="decimal"
                    value={dealSettings.fees.ebayFvfPct}
                    onChange={(event) =>
                      setDealSettings((settings) =>
                        normalizeDealCalcSettings({
                          ...settings,
                          fees: {
                            ...settings.fees,
                            ebayFvfPct: numberFromInput(event.target.value, settings.fees.ebayFvfPct),
                          },
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  Promoted %
                  <input
                    name="promoted-listing-percent"
                    autoComplete="off"
                    inputMode="decimal"
                    value={dealSettings.fees.promotedPct}
                    onChange={(event) =>
                      setDealSettings((settings) =>
                        normalizeDealCalcSettings({
                          ...settings,
                          fees: {
                            ...settings.fees,
                            promotedPct: numberFromInput(event.target.value, settings.fees.promotedPct),
                          },
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  Fixed fee
                  <MoneyInput
                    name="ebay-fixed-fee"
                    autoComplete="off"
                    value={penceToPounds(dealSettings.fees.ebayFixedPence)}
                    onChange={(value) =>
                      setDealSettings((settings) =>
                        normalizeDealCalcSettings({
                          ...settings,
                          fees: { ...settings.fees, ebayFixedPence: poundsToPence(value) },
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  Materials
                  <MoneyInput
                    name="listing-materials-cost"
                    autoComplete="off"
                    value={penceToPounds(dealSettings.fees.materialsPence)}
                    onChange={(value) =>
                      setDealSettings((settings) =>
                        normalizeDealCalcSettings({
                          ...settings,
                          fees: { ...settings.fees, materialsPence: poundsToPence(value) },
                        }),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="panel settings-section" id="risk-delivery" aria-labelledby="risk-delivery-title">
            <div className="settings-section-header">
              <div className="settings-section-title">
                <span className="settings-section-kicker">Fulfilment guardrails</span>
                <h2 id="risk-delivery-title">Risk &amp; delivery</h2>
                <p>Account for dispatch cost, evidence quality and how easily a card should sell.</p>
              </div>
            </div>
            <div className="settings-subsection">
              <div className="settings-subsection-heading">
                <h3>Postage tiers</h3>
                <p>Used when estimating what actually banks after a sale.</p>
              </div>
              <div className="form-grid settings-field-grid settings-field-grid-three">
                <label>
                  Under £20
                  <MoneyInput
                    name="postage-under-20"
                    autoComplete="off"
                    value={penceToPounds(dealSettings.fees.postageTiers[0]?.postagePence ?? 0)}
                    onChange={(value) =>
                      setDealSettings((settings) => updateDealPostageTier(settings, 0, poundsToPence(value)))
                    }
                  />
                </label>
                <label>
                  £20-£100
                  <MoneyInput
                    name="postage-20-to-100"
                    autoComplete="off"
                    value={penceToPounds(dealSettings.fees.postageTiers[1]?.postagePence ?? 0)}
                    onChange={(value) =>
                      setDealSettings((settings) => updateDealPostageTier(settings, 1, poundsToPence(value)))
                    }
                  />
                </label>
                <label>
                  Over £100
                  <MoneyInput
                    name="postage-over-100"
                    autoComplete="off"
                    value={penceToPounds(dealSettings.fees.postageTiers[2]?.postagePence ?? 0)}
                    onChange={(value) =>
                      setDealSettings((settings) => updateDealPostageTier(settings, 2, poundsToPence(value)))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="settings-subsection settings-risk-grid">
              <div>
                <div className="settings-subsection-heading">
                  <h3>Confidence haircuts</h3>
                  <p>Lower confidence reduces the bid or blocks a risky buy.</p>
                </div>
                <div className="form-grid settings-field-grid settings-field-grid-three">
                  <label>
                    High
                    <input
                      name="confidence-haircut-high"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.confidenceHaircut.high}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            confidenceHaircut: {
                              ...settings.confidenceHaircut,
                              high: numberFromInput(event.target.value, settings.confidenceHaircut.high),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Medium
                    <input
                      name="confidence-haircut-medium"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.confidenceHaircut.medium}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            confidenceHaircut: {
                              ...settings.confidenceHaircut,
                              medium: numberFromInput(event.target.value, settings.confidenceHaircut.medium),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Low
                    <input
                      name="confidence-haircut-low"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.confidenceHaircut.low}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            confidenceHaircut: {
                              ...settings.confidenceHaircut,
                              low: numberFromInput(event.target.value, settings.confidenceHaircut.low),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
              <div>
                <div className="settings-subsection-heading">
                  <h3>Liquidity haircuts</h3>
                  <p>Adjust the bid for the available number of sold examples.</p>
                </div>
                <div className="form-grid settings-field-grid settings-field-grid-three">
                  <label>
                    n ≥ 100
                    <input
                      name="liquidity-haircut-100-plus"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.liquidityHaircut.nAtLeast100}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            liquidityHaircut: {
                              ...settings.liquidityHaircut,
                              nAtLeast100: numberFromInput(event.target.value, settings.liquidityHaircut.nAtLeast100),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    n 30-99
                    <input
                      name="liquidity-haircut-30-to-99"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.liquidityHaircut.n30To99}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            liquidityHaircut: {
                              ...settings.liquidityHaircut,
                              n30To99: numberFromInput(event.target.value, settings.liquidityHaircut.n30To99),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    n under 30
                    <input
                      name="liquidity-haircut-under-30"
                      autoComplete="off"
                      inputMode="decimal"
                      value={dealSettings.liquidityHaircut.nUnder30}
                      onChange={(event) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            liquidityHaircut: {
                              ...settings.liquidityHaircut,
                              nUnder30: numberFromInput(event.target.value, settings.liquidityHaircut.nUnder30),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="panel settings-section" id="grading-policy" aria-labelledby="grading-policy-title">
            <div className="settings-section-header">
              <div className="settings-section-title">
                <span className="settings-section-kicker">Collector outcomes</span>
                <h2 id="grading-policy-title">Grading EV</h2>
                <p>Model the submission cost and likely returns when raw comps expose graded signals.</p>
              </div>
            </div>
            <div className="settings-grading-grid">
              <div className="settings-subsection">
                <div className="settings-subsection-heading">
                  <h3>Submission costs</h3>
                  <p>Every cost required to get the card in front of a grader.</p>
                </div>
                <div className="form-grid settings-field-grid">
                  <label>
                    Grading cost
                    <MoneyInput
                      name="grading-cost"
                      autoComplete="off"
                      value={penceToPounds(dealSettings.grading.costPence)}
                      onChange={(value) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            grading: { ...settings.grading, costPence: poundsToPence(value) },
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Post to grader
                    <MoneyInput
                      name="grading-postage"
                      autoComplete="off"
                      value={penceToPounds(dealSettings.grading.postageToGraderPence)}
                      onChange={(value) =>
                        setDealSettings((settings) =>
                          normalizeDealCalcSettings({
                            ...settings,
                            grading: { ...settings.grading, postageToGraderPence: poundsToPence(value) },
                          }),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="settings-subsection">
                <div className="settings-subsection-heading">
                  <h3>Grade probabilities</h3>
                  <p>The expected distribution used in the grading return calculation.</p>
                </div>
                <div className="form-grid settings-field-grid settings-field-grid-three">
                  {(["PSA_10", "PSA_9", "PSA_8"] as const).map((gradeKey) => (
                    <label key={gradeKey}>
                      {gradeKey.replace(/_/g, " ")} odds
                      <input
                        name={`grade-probability-${gradeKey.toLowerCase().replace(/_/g, "-")}`}
                        autoComplete="off"
                        inputMode="decimal"
                        value={dealSettings.grading.gradeProbabilities[gradeKey] ?? 0}
                        onChange={(event) =>
                          setDealSettings((settings) =>
                            normalizeDealCalcSettings({
                              ...settings,
                              grading: {
                                ...settings.grading,
                                gradeProbabilities: {
                                  ...settings.grading.gradeProbabilities,
                                  [gradeKey]: numberFromInput(
                                    event.target.value,
                                    settings.grading.gradeProbabilities[gradeKey] ?? 0,
                                  ),
                                },
                              },
                            }),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function formatAge(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function numberFromInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateDealPostageTier(settings: DealCalcSettings, index: number, postagePence: number): DealCalcSettings {
  const tiers = [...settings.fees.postageTiers];
  const current = tiers[index] ?? { upToPence: null, postagePence: 0 };
  tiers[index] = { ...current, postagePence };
  return normalizeDealCalcSettings({
    ...settings,
    fees: { ...settings.fees, postageTiers: tiers },
  });
}

function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

function poundsToPence(value: string): number {
  const normalized = value.replace(/[^0-9.-]/g, "");
  const pounds = Number(normalized);
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;
}
