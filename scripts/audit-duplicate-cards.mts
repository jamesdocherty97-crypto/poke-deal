import { PrismaClient } from "@prisma/client";

import { groupDuplicateCardIdentities } from "../src/lib/catalog/duplicateCards.js";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
  const cards = await prisma.card.findMany({
    select: {
      id: true,
      game: true,
      language: true,
      name: true,
      setName: true,
      number: true,
      edition: true,
      finish: true,
      tcgApiId: true,
      tcgDexId: true,
      cardmarketId: true,
      _count: {
        select: {
          checkedComps: true,
          comps: true,
          inventory: true,
          snapshots: true,
          watches: true,
          dealSessionLines: true,
          scanEvents: true,
        },
      },
    },
    orderBy: [{ game: "asc" }, { language: "asc" }, { setName: "asc" }, { number: "asc" }, { id: "asc" }],
  });

  const grouped = groupDuplicateCardIdentities(cards);
  const referencedGroups = grouped.groups.filter((group) => group.some((card) => referenceCount(card) > 0));
  const referencedConflicts = grouped.conflicts.filter((conflict) => conflict.members.some((card) => referenceCount(card) > 0));
  const groupsToPrint = process.argv.includes("--all") ? grouped.groups : referencedGroups;

  console.log(`Safe duplicate card groups: ${grouped.groups.length}`);
  console.log(`Safe groups with persisted references: ${referencedGroups.length}`);
  console.log(`Ambiguous groups left untouched: ${grouped.conflicts.length}`);
  console.log(`Ambiguous groups with persisted references: ${referencedConflicts.length}`);
  if (groupsToPrint.length < grouped.groups.length) {
    console.log(`Showing referenced safe groups only; pass --all to print all ${grouped.groups.length} groups.`);
  }

  for (const [index, group] of groupsToPrint.entries()) {
    const first = group[0]!;
    console.log(`\n[${index + 1}] ${first.game}/${first.language} · ${first.setName} · ${first.name} · ${first.number}`);
    for (const card of group) console.log(JSON.stringify(auditRow(card)));
  }

  if (grouped.conflicts.length > 0) {
    console.log("\nAmbiguous identities (never auto-merged):");
    for (const conflict of grouped.conflicts) {
      console.log(JSON.stringify({
        reason: conflict.reason,
        cards: conflict.members.map(auditRow),
      }));
    }
  }
} finally {
  await prisma.$disconnect();
}

function referenceCount(card: { _count: Record<string, number> }): number {
  return Object.values(card._count).reduce((sum, count) => sum + count, 0);
}

function auditRow(card: {
  id: string;
  name: string;
  number: string | null;
  edition: string | null;
  finish: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
  cardmarketId: string | null;
  _count: Record<string, number>;
}) {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    edition: card.edition,
    finish: card.finish,
    providerIds: {
      tcgApiId: card.tcgApiId,
      tcgDexId: card.tcgDexId,
      cardmarketId: card.cardmarketId,
    },
    references: card._count,
  };
}
