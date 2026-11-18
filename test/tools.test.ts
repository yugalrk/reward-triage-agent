import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRiskSignals, executeTool } from "../src/tools.js";

describe("executeTool scope", () => {
  const scope = { userId: "u_jack" };

  it("lets the agent read the ticket owner's events", () => {
    const result = executeTool("getUserEvents", { userId: "u_jack", offerId: "off_dragon" }, scope) as { events: unknown[] };
    assert.equal(result.events.length, 2);
  });

  it("blocks reading another user's events", () => {
    assert.throws(() => executeTool("getUserEvents", { userId: "u_alice", offerId: "off_dragon" }, scope), /Access denied/);
  });

  it("blocks risk checks on another user", () => {
    assert.throws(() => executeTool("checkRiskSignals", { userId: "u_eve" }, scope), /Access denied/);
  });

  it("allows offer rules for any offer", () => {
    assert.doesNotThrow(() => executeTool("getOfferRules", { offerId: "off_coin" }, scope));
  });
});

describe("checkRiskSignals", () => {
  it("flags four accounts on one device", () => {
    const risk = checkRiskSignals("u_eve");
    assert.equal(risk.flagged, true);
    assert.ok(
      risk.signals.some((s) => s.startsWith("multi_account_device: 4 accounts on device dev_9f3")),
      `got: ${risk.signals.join(" | ")}`,
    );
  });

  it("flags level 50 reached 35 minutes after install", () => {
    const risk = checkRiskSignals("u_gina");
    assert.equal(risk.flagged, true);
    assert.ok(
      risk.signals.some((s) => s.startsWith("impossible_speed: off_coin milestone reached 35 min after install")),
      `got: ${risk.signals.join(" | ")}`,
    );
  });

  it("does not flag an ordinary user", () => {
    assert.deepEqual(checkRiskSignals("u_alice"), { userId: "u_alice", flagged: false, signals: [] });
  });
});
