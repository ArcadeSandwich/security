# SEC-AG-16b: hostile test for the secret scan of Control's tracker block

Status: test only (for Logging); the fix is Logging's own
Rank: medium. Control is read-only now; its tracker block is the one way text leaves it, and Work commits and pushes that block.
Prepared by Security · Agents, 2026-10-20, against oak-world-work 17c2960 (control-tracker.mjs, liveSecretIn).

## What the test shows (run on a scratch copy, 2026-10-20)
- PASS: a block that holds a live value as it is gets refused.
- FAIL (11): these all get through today:
  - 6 key-shaped values that are not in the live list (Anthropic-, OpenAI-, Google-, Groq- and GitHub-shaped, and a private-key header);
  - the live value spaced out, joined with zero-width characters, in base64, reversed, or split across two cells.

liveSecretIn checks only `text.includes(value)` against the live list. That stops an accident, but not a model that has been talked into hiding a key.

## Suggested fix (Logging)
1. Before scanning, normalise the block: remove whitespace and zero-width characters, then scan both the normalised text and the joined cells of each row.
2. Also scan the base64-decoded and the reversed form of long tokens (20 characters or more of [A-Za-z0-9+/=_-]).
3. Add a shape rule that refuses any token matching a known key shape (sk-ant-, sk-, sk-proj-, AIza, gsk_, ghp_/gho_/github_pat_, -----BEGIN ... PRIVATE KEY-----, and any [A-Za-z0-9_-]{32,} token). Tracker rows never need such text.
4. Keep failing closed when check.js can't load.

## Run
1. Copy control-tracker.mjs to a scratch folder (never test in C:\server\oak-world-work itself).
2. `set CT=<scratch>\control-tracker.mjs`, then in this folder: `node --test SEC-AG-16b-hostile.test.mjs`
3. All 12 tests must pass after the fix.

The test points OAK_CHECK_JS at `fake-check.cjs`, which holds one made-up value, so no real key is ever used or shown.

## Undo
Nothing to undo: these are test files only.
