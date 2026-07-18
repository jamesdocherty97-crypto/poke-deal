import assert from "node:assert/strict";
import test from "node:test";
import { ScanError, type ScanResult } from "./cardScan.js";
import { scanEventDataFromError, scanEventDataFromResult } from "./scanEvent.js";

test("scanEventDataFromResult stores a readable raw-card observation", () => {
  const result: ScanResult = {
    model: "gemini-flash-latest",
    usage: { promptTokens: 121, outputTokens: 34, totalTokens: 155 },
    identity: {
      name: "Tauros",
      setName: "Chaos Rising",
      setCode: "ME04",
      number: "069/086",
      language: "English",
      isSlab: false,
      grader: null,
      grade: null,
      certNumber: null,
      stamps: [],
      readable: true,
      notes: "",
    },
  };

  const event = scanEventDataFromResult(result, "gemini-scan", { latencyMs: 912, requestBytes: 2048, inputKind: "camera" });

  assert.equal(event.source, "gemini-scan");
  assert.equal(event.status, "READABLE");
  assert.equal(event.name, "Tauros");
  assert.equal(event.number, "069/086");
  assert.equal(event.language, "EN");
  assert.equal(event.grade, "RAW");
  assert.equal(event.model, "gemini-flash-latest");
  assert.deepEqual(event.raw, { identity: result.identity, promptVersion: "legacy-unversioned", usage: result.usage });
  assert.equal(event.latencyMs, 912);
  assert.equal(event.requestBytes, 2048);
  assert.equal(event.inputKind, "camera");
});

test("scanEventDataFromResult stores slab grade when canonical", () => {
  const event = scanEventDataFromResult({
    model: "gemini-flash-latest",
    identity: {
      name: "Lugia",
      setName: "Neo Genesis",
      setCode: null,
      number: "9/111",
      language: "English",
      isSlab: true,
      grader: "CGC",
      grade: "1.5",
      certNumber: "123",
      stamps: [],
      readable: true,
      notes: "",
    },
  });

  assert.equal(event.grade, "CGC_1_5");
});

test("scanEventDataFromError stores error kind without throwing", () => {
  const event = scanEventDataFromError(new ScanError("quota hit", "quota"));
  const raw = event.raw as { message?: string; kind?: string };

  assert.equal(event.status, "ERROR");
  assert.equal(raw.message, "quota hit");
  assert.equal(raw.kind, "quota");
});
