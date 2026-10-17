import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("schema money fields are integer pence", () => {
  const schema = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../prisma/schema.prisma"), "utf8");
  const fields = moneyFields(schema);
  assert.ok(fields.length >= 20, `expected the known pence columns, found ${fields.length}`);
  const offenders = fields.filter((field) => field.type !== "Int" && field.type !== "Int?");
  assert.deepEqual(offenders, []);
});

function moneyFields(schema: string): Array<{ model: string; name: string; type: string }> {
  const found: Array<{ model: string; name: string; type: string }> = [];
  for (const model of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
    const modelName = model[1]!;
    for (const line of model[2]!.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@") || trimmed.startsWith("[")) continue;
      const parsed = /^(\w+)\s+(\w+\??)/.exec(trimmed);
      if (!parsed) continue;
      const name = parsed[1]!;
      const type = parsed[2]!;
      const comment = trimmed.split("//")[1] ?? "";
      const namedPence = /pence$/i.test(name);
      const commentPence = /\bpence\b/i.test(comment);
      if (namedPence || commentPence) found.push({ model: modelName, name, type });
    }
  }
  return found;
}
