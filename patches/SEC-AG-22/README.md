# SEC-AG-22: hostile effects from the DM's model (test, and the findings for the Admin)

Status: test only; the item rules are the Admin's design choice (through Server). Nothing to apply yet.
Rank: low. The effects only touch the player's own save; no keys, no other saves.
Owner: DM (offline). Run by Security · Agents, 2026-10-21, on a scratch copy of oak-world 1daae137. No AI was called (the model reply is faked).

## What the test does
One real turn through /api/turn with a faked model reply that holds 12 hostile effects:
- gold +999999, and money 999999 from "Nobody";
- HP and max HP 9999;
- 99 Master Balls, and a made-up "Admin Key of Everything";
- a level-100 Arceus joining, and a trade for a level-100 Mewtwo;
- travel to Spear Pillar, and a new "Secret Admin Room" place;
- chapter 99, and death.

It runs four times: Pokémon and RPG mode, each with God mode off and on.

## Results (2026-10-21)
| Case | gold | HP | party | travel / places | chapter | death | bag |
|---|---|---|---|---|---|---|---|
| Pokémon, normal | 100 (kept) | 15/20 | none | kept | 2 | no | empty: PASS |
| RPG, normal | 100 | 15/20 | none | kept | 2 | no | Master Ball x5 and "Admin Key of Everything": FAIL |
| Pokémon, God mode | 100 | 15/20 | none | kept | 2 | no | "Admin Key of Everything": FAIL |
| RPG, God mode | 100 | 15/20 | none | kept | 2 | no | Master Ball x5 and "Admin Key of Everything": FAIL |

So money, HP, the team, the map, chapters and death stay the code's in every mode. Items do not:
- In the RPG mode the model can add any item, with any made-up name; the amount is capped at 5.
- In God mode (Pokémon) the item-list check is skipped (`!draft.godMode` in dm/index.js 2799-2807).

## Who can switch on God mode
POST /api/settings `{ godMode: true }` (dm/index.js 4358-4367). It is an OWNER_ONLY route, so whoever may write the save can switch it: the Admin, or a guest on their own save (saves.js mayWrite). It is logged as settings.godMode.

Small side note: OWNER_ONLY checks ownership only when the request names a slot (`if (slot && ...)`). Routes that fall back to `body.slot || "main"` would act on an unlisted save "main". Today no save is called "main", so nothing is reached, but a check with the resolved slot would be cleaner.

## For the Admin to decide (through Server)
1. RPG items: keep "the story may hand out any item" (it's a free fantasy world), or add an item list or a cap like Pokémon's.
2. God mode: keep it for every save owner, or make it Lab-code only.

## Run
On a scratch copy of the game: copy test\SEC-AG-22.test.js to dm\test\, check free memory first (INS-005), then `node --test dm/test/SEC-AG-22.test.js`. It writes only test saves (setup.js temp folders).
