// SEC-PROG-19: run with `bun test frontend/app/lib/admin-check.test.ts` from the repository root. Needs no .env and no database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAdminSession, twitchAccountId } from "./admin-check";

const MAIN = "111";
const listed = async (id: string) => id === "222";
const session = (accountId?: string, provider = "twitch") => ({
  user: { id: "u1" },
  accounts: accountId ? [{ provider, accountId }] : [],
});

describe("isAdminSession", () => {
  test("no session is not an admin", async () => {
    expect(await isAdminSession(undefined, MAIN, listed)).toBe(false);
    expect(await isAdminSession(null, MAIN, listed)).toBe(false);
  });
  test("a session without a Twitch account is not an admin", async () => {
    expect(await isAdminSession(session("111", "github"), MAIN, listed)).toBe(false);
    expect(await isAdminSession(session(), MAIN, listed)).toBe(false);
  });
  test("the main admin and a listed admin are admins", async () => {
    expect(await isAdminSession(session("111"), MAIN, listed)).toBe(true);
    expect(await isAdminSession(session("222"), MAIN, listed)).toBe(true);
  });
  test("any other signed-in Twitch user is not an admin", async () => {
    expect(await isAdminSession(session("333"), MAIN, listed)).toBe(false);
  });
  test("an empty main-admin setting matches nobody", async () => {
    expect(await isAdminSession(session(""), "", listed)).toBe(false);
    expect(twitchAccountId(session(""))).toBe(null);
  });
});

// Every server function in the two services runs behind adminMiddleware, except getOverlayById (the public OBS overlay page).
describe("every dashboard server function checks the admin", () => {
  const PUBLIC = new Set(["getOverlayById"]);
  for (const file of ["services/twitch-users.ts", "services/clips.ts"]) {
    const src = readFileSync(join(import.meta.dir, "..", file), "utf8");
    const fns = [...src.matchAll(/export const (\w+) = createServerFn\(/g)];
    test(`${file} has server functions`, () => expect(fns.length).toBeGreaterThan(0));
    for (const m of fns) {
      const name = m[1];
      const rest = src.slice(m.index ?? 0);
      const chain = rest.slice(0, rest.indexOf(".handler("));
      test(`${name} ${PUBLIC.has(name) ? "stays public" : "uses adminMiddleware"}`, () => {
        expect(chain.includes(".middleware([adminMiddleware])")).toBe(!PUBLIC.has(name));
      });
    }
  }
});
