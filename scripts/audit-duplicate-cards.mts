import { PrismaClient } from "@prisma/client";

import { collectorNumbersEquivalent, normalizeSetNameForCompare } from "../src/lib/cards/identity.js";

const prisma = new PrismaClient();

try {
  const cards = await prisma.card.findMany({
    select: {
      id: true,
      game: true,
      language: true,
      name: true,
      setName: true,
      number: true,
      tcgApiId: true,
      tcgDexId: true,
      cardmarketId: true,
      _count: { select: { checkedComps: true, comps: true, inventory: true } },
    },
    orderBy: [{ game: "asc" }, { language: "asc" }, { setName: "asc" }, { number: "asc" }, { id: "asc" }],
  });

  const buckets = new Map<string, typeof cards>();
  for (const card of cards) {
    if (!card.number) continue;
    const key = `${card.game}\u0000${card.language}\u0000${normalizeSetNameForCompare(card.setName)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), card]);
  }

  const duplicateGroups: Array<typeof cards> = [];
  for (const bucket of buckets.values()) {
    const remaining = [...bucket];
    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const group = [seed];
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (collectorNumbersEquivalent(seed.number, remaining[index]?.number)) {
          group.push(remaining[index]!);
          remaining.splice(index, 1);
        }
      }
      if (group.length > 1) duplicateGroups.push(group.sort((left, right) => left.id.localeCompare(right.id)));
    }
  }

  const referencedGroups = duplicateGroups.filter((group) =>
    group.some((card) => card._count.checkedComps + card._count.comps + card._count.inventory > 0),
  );
  const groupsToPrint = process.argv.includes("--all") ? duplicateGroups : referencedGroups;
  console.log(`Suspected duplicate card groups: ${duplicateGroups.length}`);
  console.log(`Groups with checked-comp, comp-result or inventory references: ${referencedGroups.length}`);
  if (groupsToPrint.length < duplicateGroups.length) {
    console.log(`Showing referenced groups only; pass --all to print all ${duplicateGroups.length} groups.`);
  }
  for (const [index, group] of groupsToPrint.entries()) {
    const first = group[0]!;
    console.log(`\n[${index + 1}] ${first.game}/${first.language} · ${first.setName} · equivalent number ${first.number}`);
    for (const card of group) {
      console.log(JSON.stringify({
        id: card.id,
        name: card.name,
        number: card.number,
        providerIds: {
          tcgApiId: card.tcgApiId,
          tcgDexId: card.tcgDexId,
          cardmarketId: card.cardmarketId,
        },
        references: {
          checkedComps: card._count.checkedComps,
          compResults: card._count.comps,
          inventoryItems: card._count.inventory,
        },
      }));
    }
  }
} finally {
  await prisma.$disconnect();
}
