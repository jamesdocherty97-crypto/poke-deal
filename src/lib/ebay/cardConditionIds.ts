// eBay category 183454 (Pokémon singles) condition IDs.
//
// Pure lookup: no listing-pack, database, or network imports. Callers normalise
// a raw condition to NM/LP/MP/HP/DMG before asking for a card-condition ID.
// DMG uses 400017, the same heavily-played bucket as HP.

import type { RawCondition } from "../domain/types.js";

export const PROFESSIONAL_GRADER_IDS: Record<string, string> = {
  PSA: "275010",
  BCCG: "275011",
  BVG: "275012",
  BGS: "275013",
  CSG: "275014",
  CGC: "275015",
  SGC: "275016",
  KSA: "275017",
  GMA: "275018",
  HGA: "275019",
  ISA: "2750110",
  PCA: "2750111",
  GSG: "2750112",
  PGS: "2750113",
  MNT: "2750114",
  TAG: "2750115",
  RARE: "2750116",
  RCG: "2750117",
  PCG: "2750118",
  ACE: "2750119",
  CGA: "2750120",
  TCG: "2750121",
  ARK: "2750122",
};
export const PROFESSIONAL_GRADER_OTHER_ID = "2750123";

export const GRADE_VALUE_IDS: Record<string, string> = {
  "10": "275020",
  "9.5": "275021",
  "9": "275022",
  "8.5": "275023",
  "8": "275024",
  "7.5": "275025",
  "7": "275026",
  "6.5": "275027",
  "6": "275028",
  "5.5": "275029",
  "5": "2750210",
  "4.5": "2750211",
  "4": "2750212",
  "3.5": "2750213",
  "3": "2750214",
  "2.5": "2750215",
  "2": "2750216",
  "1.5": "2750217",
  "1": "2750218",
};

/** Category 183454 accepts these four ungraded card-condition descriptor values. */
export const NEAR_MINT_OR_BETTER_ID = "400010";
export const LIGHTLY_PLAYED_ID = "400015";
export const MODERATELY_PLAYED_ID = "400016";
export const HEAVILY_PLAYED_ID = "400017";

const UNGRADED_CARD_CONDITION_IDS: Record<RawCondition, string> = {
  NM: NEAR_MINT_OR_BETTER_ID,
  LP: LIGHTLY_PLAYED_ID,
  MP: MODERATELY_PLAYED_ID,
  HP: HEAVILY_PLAYED_ID,
  DMG: HEAVILY_PLAYED_ID,
};

export interface EbayCardConditionIds {
  conditionId: "2750" | "4000";
  graderId?: string;
  gradeId?: string;
  cardConditionId?: string;
}

/** Parses a grade like "PSA_9_5" -> { grader: "PSA", gradeValue: "9.5" }; "ACE_10" -> { grader: "ACE", gradeValue: "10" }. */
export function parseGradedGrade(grade: string): { grader: string; gradeValue: string } {
  const parts = grade.split("_");
  const grader = parts[0] ?? "";
  const gradeValue = parts.slice(1).join(".");
  return { grader, gradeValue };
}

export function ebayCardConditionIds(input: {
  graded: boolean;
  grader?: string | null;
  gradeValue?: string | null;
  rawCondition?: string | null;
}): EbayCardConditionIds {
  if (input.graded) {
    const graderId = PROFESSIONAL_GRADER_IDS[input.grader ?? ""] ?? PROFESSIONAL_GRADER_OTHER_ID;
    const gradeId = GRADE_VALUE_IDS[input.gradeValue ?? ""];
    return {
      conditionId: "2750",
      graderId,
      ...(gradeId ? { gradeId } : {}),
    };
  }

  const cardConditionId = ungradedCardConditionId(input.rawCondition);
  return {
    conditionId: "4000",
    ...(cardConditionId ? { cardConditionId } : {}),
  };
}

/** Damaged singles use eBay's lowest supported CCG bucket, with DMG retained in copy. */
function ungradedCardConditionId(rawCondition?: string | null): string | undefined {
  const code = rawCondition?.trim().toUpperCase();
  if (code === "NM" || code === "LP" || code === "MP" || code === "HP" || code === "DMG") {
    return UNGRADED_CARD_CONDITION_IDS[code];
  }
  return undefined;
}
