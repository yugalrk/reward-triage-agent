import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRiskSignals } from "../src/tools.js";

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
