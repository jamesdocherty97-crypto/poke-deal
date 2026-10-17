import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLEANING = path.join(REPO_ROOT, "src/lib/comps/cleaning.ts");

const FORBIDDEN_EXTERNAL = [
  "@prisma/client",
  "next",
  "next/",
  "react",
  "react-dom",
  "fs",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
];

test("cleaning.ts reaches only pure local modules", () => {
  const seen = new Set<string>();
  const graph = walkLocal(CLEANING, seen);
  const rel = graph.map((file) => path.relative(REPO_ROOT, file));
  assert.ok(rel.includes("src/lib/comps/fxConvert.ts"));
  assert.equal(rel.some((file) => file.endsWith("src/lib/comps/currency.ts") || file.endsWith(`${path.sep}currency.ts`)), false);
  assert.equal(rel.some((file) => file.includes(`${path.sep}db${path.sep}`)), false);
  assert.equal(rel.some((file) => file.includes("fetchReadWithRetry")), false);
  const source = fs.readFileSync(CLEANING, "utf8");
  assert.equal(source.includes("currency.js"), false);
  assert.equal(source.includes("prisma"), false);
});

function walkLocal(file: string, seen: Set<string>): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = fs.readFileSync(file, "utf8");
  const specs = [
    ...text.matchAll(/from\s+["']([^"']+)["']/g),
    ...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]!);
  const found = [file];
  for (const spec of specs) {
    if (!spec.startsWith(".")) {
      assert.equal(
        FORBIDDEN_EXTERNAL.some((name) => spec === name || spec.startsWith(`${name}/`)),
        false,
        `${path.relative(REPO_ROOT, file)} imports ${spec}`,
      );
      continue;
    }
    found.push(...walkLocal(resolveLocal(file, spec), seen));
  }
  return found;
}

function resolveLocal(fromFile: string, spec: string): string {
  const target = path.resolve(path.dirname(fromFile), spec).replace(/\.js$/, "");
  const candidates = [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")];
  const hit = candidates.find((candidate) => fs.existsSync(candidate));
  if (!hit) throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
  return hit;
}
