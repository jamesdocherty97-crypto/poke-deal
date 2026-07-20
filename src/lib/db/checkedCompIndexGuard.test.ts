import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  CHECKED_COMP_ACTIVE_LISTING_INDEX,
  EXPECTED_CHECKED_COMP_ACTIVE_LISTING_INDEXDEF,
  inspectCheckedCompActiveListingIndex,
} from "./checkedCompIndexGuard.js";

test("checked-comp partial-index contract rejects missing and full unique indexes", () => {
  assert.equal(inspectCheckedCompActiveListingIndex(null).ok, false);
  assert.equal(
    inspectCheckedCompActiveListingIndex(
      'CREATE UNIQUE INDEX "CheckedComp_sourceListingId_key" ON public."CheckedComp" USING btree ("sourceListingId")',
    ).ok,
    false,
  );
  assert.deepEqual(inspectCheckedCompActiveListingIndex(EXPECTED_CHECKED_COMP_ACTIVE_LISTING_INDEXDEF), {
    ok: true,
    detail: "Active checked-comp listing IDs retain the required partial unique index.",
  });
});

test("database keeps the exact checked-comp partial unique index", async (context) => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    context.skip("DATABASE_URL is not set; physical index guard skipped cleanly");
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'CheckedComp'
        AND indexname = ${CHECKED_COMP_ACTIVE_LISTING_INDEX}
    `;
    assert.equal(rows.length, 1, `${CHECKED_COMP_ACTIVE_LISTING_INDEX} must exist exactly once`);
    assert.equal(rows[0]?.indexdef, EXPECTED_CHECKED_COMP_ACTIVE_LISTING_INDEXDEF);
  } finally {
    await prisma.$disconnect();
  }
});
