import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type FixtureProbe = {
  slug: string;
  card: { name: string; setName?: string; number?: string };
  grade: string;
};

const probes: FixtureProbe[] = [
  { slug: "umbreon-evolving-skies-raw-ambiguous", card: { name: "Umbreon", setName: "Evolving Skies" }, grade: "RAW" },
  { slug: "charizard-base-4-102-raw", card: { name: "Charizard", setName: "Base", number: "4/102" }, grade: "RAW" },
  { slug: "umbreon-vmax-215-203-raw", card: { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203" }, grade: "RAW" },
  { slug: "charizard-ex-151-199-165-psa10", card: { name: "Charizard ex", setName: "151", number: "199/165" }, grade: "PSA_10" },
  { slug: "victini-svp-208-raw", card: { name: "Victini", setName: "Scarlet & Violet Promos", number: "SVP 208" }, grade: "RAW" },
  { slug: "zapdos-151-192-raw", card: { name: "Zapdos ex", setName: "151", number: "192/165" }, grade: "RAW" },
];

const baseUrl = process.env.POKE_DEAL_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir =
  process.env.POKE_DEAL_COMP_FIXTURE_DIR ??
  path.join(process.cwd(), "src/lib/comps/__fixtures__/live-regression");

await mkdir(outputDir, { recursive: true });

for (const probe of probes) {
  const url = new URL("/api/comps", baseUrl);
  url.searchParams.set("name", probe.card.name);
  if (probe.card.setName) url.searchParams.set("setName", probe.card.setName);
  if (probe.card.number) url.searchParams.set("number", probe.card.number);
  url.searchParams.set("grade", probe.grade);

  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.POKE_DEAL_BASIC_AUTH) {
    headers.authorization = `Basic ${Buffer.from(process.env.POKE_DEAL_BASIC_AUTH).toString("base64")}`;
  }

  const response = await fetch(url, { headers });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${probe.slug} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  const fixture = {
    capturedAt: new Date().toISOString(),
    request: {
      url: url.toString(),
      card: probe.card,
      grade: probe.grade,
    },
    response: json,
  };
  const target = path.join(outputDir, `${probe.slug}.json`);
  await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`captured ${probe.slug} -> ${path.relative(process.cwd(), target)}`);
}
