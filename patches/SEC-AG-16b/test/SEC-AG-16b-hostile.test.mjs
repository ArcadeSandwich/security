// SEC-AG-16b hostile test (Security · Agents, 2026-10-20) for control-tracker.mjs's secret scan of the tracker block.
// Runs against a stand-in check.js (fake-check.cjs, one made-up "live" value), never the real keys.
// Usage, on a scratch copy of oak-world-work:  node --test <this file>   (set CT to the control-tracker.mjs to test)
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.OAK_CHECK_JS = path.join(here, "fake-check.cjs"); // before the module loads its checker
const { FAKE } = createRequire(import.meta.url)("./fake-check.cjs");
const CT = process.env.CT || "C:\\server\\oak-world-work\\control-tracker.mjs";
const { parseBlock } = await import(pathToFileURL(CT).href);

const block = (what) => "ok\n```tracker\nFILE docs/TRACKER.md\nADD | OR990 | " + what + " | DM | Open | check | - |\n```";
const refused = (what, why) => {
  const r = parseBlock(block(what));
  assert.strictEqual(r.ok, false, `${why}: the block was accepted`);
};

// 1. Must already pass (Logging's scan as built).
test("live value as is: refused", () => refused(`key is ${FAKE}`, "plain live value"));

// 2. Key-shaped values that are NOT in the live list. The lead asked that these be refused too: they may be another chat's key,
//    a key not loaded into the Windows environment, or a key the Admin has not rotated yet. Expected to FAIL until a shape rule is added.
const SHAPES = {
  "Anthropic-shaped": "sk-ant-api03-" + "Zx9".repeat(30) + "AA",
  "OpenAI-shaped": "sk-proj-" + "Q7w".repeat(16),
  "Google-shaped": "AIzaSy" + "B".repeat(33),
  "Groq-shaped": "gsk_" + "m4".repeat(26),
  "GitHub-token-shaped": "ghp_" + "R5".repeat(18),
  "private-key header": ["-----BEGIN OPENSSH", "PRIVATE KEY-----"].join(" "), // built from parts so the library's own secret check stays clean
};
for (const [name, value] of Object.entries(SHAPES)) {
  test(`key shape not in the live list (${name}): refused`, () => refused(`see ${value}`, name));
}

// 3. The live value, disguised. Expected to FAIL on the plain includes() scan; each one is a way a model could be talked into it.
const DISGUISES = {
  "spaced out": FAKE.split("").join(" "),
  "zero-width joiners": FAKE.split("").join("\u200b"),
  "base64": Buffer.from(FAKE).toString("base64"),
  "reversed": FAKE.split("").reverse().join(""),
  "split across two cells": null, // built below
};
for (const [name, value] of Object.entries(DISGUISES)) {
  if (value === null) continue;
  test(`live value ${name}: refused`, () => refused(`v=${value}`, name));
}
test("live value split across two cells: refused", () => {
  const half = Math.floor(FAKE.length / 2);
  const r = parseBlock("ok\n```tracker\nFILE docs/TRACKER.md\nADD | OR991 | a " + FAKE.slice(0, half) + " | DM | Open | " + FAKE.slice(half) + " | - |\n```");
  assert.strictEqual(r.ok, false, "split value was accepted");
});
