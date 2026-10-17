import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "output", ".git"]);

test("every test file is named by an npm script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scripts = Object.values(pkg.scripts).join("\n");
  const missing = testFiles(REPO_ROOT).filter((file) => !scripts.includes(file));
  assert.deepEqual(missing, []);
});

function testFiles(dir: string, root = dir): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      found.push(...testFiles(full, root));
      continue;
    }
    if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(entry)) {
      found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return found;
}
