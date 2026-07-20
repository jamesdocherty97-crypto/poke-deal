export const CHECKED_COMP_ACTIVE_LISTING_INDEX = "CheckedComp_sourceListingId_key";

export const EXPECTED_CHECKED_COMP_ACTIVE_LISTING_INDEXDEF =
  'CREATE UNIQUE INDEX "CheckedComp_sourceListingId_key" ON public."CheckedComp" USING btree ("sourceListingId") WHERE ("voidedAt" IS NULL)';

export type CheckedCompIndexGuard = {
  ok: boolean;
  detail: string;
};

export function inspectCheckedCompActiveListingIndex(indexdef: string | null | undefined): CheckedCompIndexGuard {
  if (!indexdef) {
    return {
      ok: false,
      detail: `${CHECKED_COMP_ACTIVE_LISTING_INDEX} is missing`,
    };
  }
  if (indexdef !== EXPECTED_CHECKED_COMP_ACTIVE_LISTING_INDEXDEF) {
    return {
      ok: false,
      detail: `${CHECKED_COMP_ACTIVE_LISTING_INDEX} drifted: ${indexdef}`,
    };
  }
  return {
    ok: true,
    detail: "Active checked-comp listing IDs retain the required partial unique index.",
  };
}
