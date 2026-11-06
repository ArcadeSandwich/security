"use strict";
require("./setup"); // OR58: shared temp dirs; must stay before any game require.
// SEC-AG-22 (Security · Agents, 2026-10-21): one real turn with a faked model reply full of hostile effects, in the Pokémon mode and
// the RPG mode, with God mode off and on. The code must keep money, HP, the party, the map and key items its own.
// No AI is called (llm.openStream is replaced). Run: node --test dm/test/SEC-AG-22.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const llm = require("../llm");
const store = require("../store");
const engine = require("../../engine");
const settings = require("../../engine/settings");
settings.useDir(path.join(__dirname, "..", "..", "engine", "test", "fixtures", "settings"));
test.after(() => settings.useDir());

const HOSTILE = [
  { kind: "gold", delta: 999999 },
  { kind: "money", amount: 999999, from: "Nobody", reason: "free money" },
  { kind: "hp", value: 9999 },
  { kind: "max_hp", value: 9999 },
  { kind: "item_add", item: { name: "Master Ball", qty: 99 } },
  { kind: "item_add", item: { name: "Admin Key of Everything", qty: 1 } },
  { kind: "party_join", member: { species: "arceus", level: 100 } },
  { kind: "trade", partner: "Nobody", give: "nothing", get: { species: "mewtwo", level: 100 } },
  { kind: "travel", to: "Spear Pillar" },
  { kind: "discover", zone: { name: "Secret Admin Room", desc: "x", scene: "road" } },
  { kind: "chapter", chapter: 99, title: "The end" },
  { kind: "death", cause: "the narrator said so" },
];

function save(slot, campaign, godMode) {
  const state = store.newState(slot);
  Object.assign(state, {
    started: true, godMode, mode: "roguelike", campaign,
    player: { ...state.player, name: "Wren", hp: 15, maxHp: 20, gold: 100 },
    location: campaign === "rpg" ? { zone: "start", sub: null, previousZone: null } : { zone: "twinleaf_town", sub: null, previousZone: null },
    choices: ["Look around", "Wait", "Rest", "Walk"],
    log: [{ role: "player", text: "(New adventure.)" }, { role: "dm", text: "You stand in town." }],
  });
  store.save(state);
  const list = path.join(store.SAVES_DIR, "saves.json");
  let all = { saves: [] };
  try { all = JSON.parse(fs.readFileSync(list, "utf8")); } catch {}
  all.saves = (all.saves || []).filter((s) => s.slot !== slot).concat([{ slot, story: campaign === "rpg" ? "rpg" : "pokemon", created: new Date().toISOString() }]);
  fs.writeFileSync(list, JSON.stringify(all));
}

async function hostileTurn(slot) {
  const dm = require("../index");
  const server = http.createServer(async (req, res) => { if (!(await dm.handle(req, res))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const real = engine.judge;
  engine.judge = (...args) => ({ ...real(...args), possible: true, outcome: "success", cost: null });
  const realStream = llm.openStream;
  llm.openStream = async (messages, opts = {}) => {
    if (opts.providers && /suggest what a player could do next/.test(messages[0]?.content || "")) return { provider: "fake", stream: (async function* () { yield '["Look around","Wait"]'; })() };
    const text = messages.map((m) => m.content).join("\n");
    if (!/@@EFFECTS/.test(text)) return { provider: "fake", stream: (async function* () { yield "{}"; })() };
    return { provider: "fake", stream: (async function* () { yield "Gold rains from the sky.\n@@EFFECTS\n" + JSON.stringify({ effects: HOSTILE, choices: ["Look around", "Wait", "Rest", "Walk"] }); })() };
  };
  try {
    await (await fetch(`http://127.0.0.1:${server.address().port}/api/turn`, { method: "POST", body: JSON.stringify({ slot, input: "I ask the sky for gold" }) })).text();
  } finally { engine.judge = real; llm.openStream = realStream; server.close(); }
  return store.load(slot);
}

for (const [campaign, godMode] of [["pokemon", false], ["rpg", false], ["pokemon", true], ["rpg", true]]) {
  test(`SEC-AG-22: hostile effects in ${campaign}, God mode ${godMode ? "ON" : "off"}`, async () => {
    const slot = `secag22_${campaign}_${godMode ? "god" : "normal"}_${process.pid}`;
    save(slot, campaign, godMode);
    const after = await hostileTurn(slot);
    const report = {
      gold: after.player.gold, hp: after.player.hp, maxHp: after.player.maxHp, dead: Boolean(after.dead),
      party: (after.party || []).map((m) => `${m.species}:${m.level}`), bag: (after.inventory || []).map((i) => `${i.name}x${i.qty || 1}`),
      zone: after.location?.zone, chapter: after.story?.chapter, zones: Object.keys(after.zones || {}).length,
    };
    console.log(`  ${campaign} god=${godMode}:`, JSON.stringify(report));
    assert.ok(after.player.gold <= 100, `gold must not grow from the model (now ${after.player.gold})`);
    assert.ok(after.player.maxHp <= 20 && after.player.hp <= 20, `HP stays the code's (hp ${after.player.hp}/${after.player.maxHp})`);
    assert.ok(!(after.party || []).some((m) => /arceus|mewtwo/i.test(m.species) && m.level >= 100), "no level-100 legendary from the story");
    assert.ok(!(after.inventory || []).some((i) => /Admin Key of Everything/i.test(i.name)), "no made-up item");
    if (!godMode) {
      assert.equal(Boolean(after.dead), false, "no death without a failed roll");
      assert.ok(!(after.inventory || []).some((i) => /Master Ball/i.test(i.name) && (i.qty || 1) >= 99), "no 99 Master Balls");
    }
  });
}
