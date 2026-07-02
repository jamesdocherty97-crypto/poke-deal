"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  DEFAULT_DEAL_CALC_SETTINGS,
  normalizeDealCalcSettings,
  type DealCalcSettings,
} from "@/lib/dealer/dealCalc";
import { MoneyInput } from "./UiBits";

export function SettingsTab({
  dealSettings,
  setDealSettings,
}: {
  dealSettings: DealCalcSettings;
  setDealSettings: Dispatch<SetStateAction<DealCalcSettings>>;
}) {
  return (
    <section className="workspace settings-workspace">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Deal calculator</h2>
            <span className="muted">These numbers set the max cash and trade offers shown after a comp.</span>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => setDealSettings(DEFAULT_DEAL_CALC_SETTINGS)}
          >
            Reset
          </button>
        </div>
        <div className="form-grid">
          <label>
            Target margin %
            <input
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
        <div className="settings-toggle-row">
          <label>
            <input
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
        <div className="form-grid">
          <label>
            eBay final value %
            <input
              inputMode="decimal"
              value={dealSettings.fees.ebayFvfPct}
              onChange={(event) =>
                setDealSettings((settings) =>
                  normalizeDealCalcSettings({
                    ...settings,
                    fees: { ...settings.fees, ebayFvfPct: numberFromInput(event.target.value, settings.fees.ebayFvfPct) },
                  }),
                )
              }
            />
          </label>
          <label>
            Promoted %
            <input
              inputMode="decimal"
              value={dealSettings.fees.promotedPct}
              onChange={(event) =>
                setDealSettings((settings) =>
                  normalizeDealCalcSettings({
                    ...settings,
                    fees: { ...settings.fees, promotedPct: numberFromInput(event.target.value, settings.fees.promotedPct) },
                  }),
                )
              }
            />
          </label>
          <label>
            Fixed fee
            <MoneyInput
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
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Postage tiers</h2>
          <span className="muted">Used when estimating what actually banks after a sale.</span>
        </div>
        <div className="form-grid">
          <label>
            Under £20
            <MoneyInput
              value={penceToPounds(dealSettings.fees.postageTiers[0]?.postagePence ?? 0)}
              onChange={(value) =>
                setDealSettings((settings) => updateDealPostageTier(settings, 0, poundsToPence(value)))
              }
            />
          </label>
          <label>
            £20-£100
            <MoneyInput
              value={penceToPounds(dealSettings.fees.postageTiers[1]?.postagePence ?? 0)}
              onChange={(value) =>
                setDealSettings((settings) => updateDealPostageTier(settings, 1, poundsToPence(value)))
              }
            />
          </label>
          <label>
            Over £100
            <MoneyInput
              value={penceToPounds(dealSettings.fees.postageTiers[2]?.postagePence ?? 0)}
              onChange={(value) =>
                setDealSettings((settings) => updateDealPostageTier(settings, 2, poundsToPence(value)))
              }
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Confidence haircuts</h2>
          <span className="muted">Lower confidence means the app bids less, or refuses big risky buys.</span>
        </div>
        <div className="form-grid">
          <label>
            High
            <input
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
        <div className="form-grid">
          <label>
            n ≥ 100
            <input
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
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Grading EV</h2>
          <span className="muted">Used when RAW comps also expose graded comp signals.</span>
        </div>
        <div className="form-grid">
          <label>
            Grading cost
            <MoneyInput
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
        <div className="form-grid">
          {(["PSA_10", "PSA_9", "PSA_8"] as const).map((gradeKey) => (
            <label key={gradeKey}>
              {gradeKey.replace(/_/g, " ")} odds
              <input
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
                          [gradeKey]: numberFromInput(event.target.value, settings.grading.gradeProbabilities[gradeKey] ?? 0),
                        },
                      },
                    }),
                  )
                }
              />
            </label>
          ))}
        </div>
      </section>
    </section>
  );
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
