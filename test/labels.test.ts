import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOfferRules, getUserEvents, checkRiskSignals } from "../src/tools.js";
import type { Offer } from "../src/data.js";

// The hard tickets sit right on a boundary. These tests make sure the data still
// supports each expected verdict, so a data edit can't silently break a label.
const facts = (userId: string, offerId: string) => ({
  ...getUserEvents(userId, offerId).summary,
  rules: getOfferRules(offerId) as Offer,
});

describe("hard ticket labels match the data", () => {
  it("t12: milestone just inside the deadline, still inside the confirmation window", () => {
    const f = facts("u_omar", "off_farm");
    assert.ok(f.daysFromClickToMilestone! < f.rules.deadlineDays, `${f.daysFromClickToMilestone} days`);
    assert.ok(f.daysFromClickToMilestone! > f.rules.deadlineDays - 0.1);
    assert.ok(f.hoursSinceMilestone! < f.rules.typicalConfirmationHours);
  });

  it("t13: milestone just after the deadline", () => {
    const f = facts("u_pia", "off_dragon");
    assert.ok(f.daysFromClickToMilestone! > f.rules.deadlineDays, `${f.daysFromClickToMilestone} days`);
    assert.ok(f.daysFromClickToMilestone! < f.rules.deadlineDays + 0.1);
  });

  it("t14: angry user is still inside the confirmation window", () => {
    const f = facts("u_quinn", "off_tower");
    assert.ok(f.hoursSinceMilestone! < f.rules.typicalConfirmationHours);
    assert.equal(checkRiskSignals("u_quinn").flagged, false);
  });

  it("t15: no click for the offer in the ticket", () => {
    assert.equal(getUserEvents("u_rosa", "off_puzzle").events.length, 0);
  });

  it("t16: the coins were paid in full", () => {
    const f = facts("u_sam", "off_dragon");
    assert.equal(f.hasPostbackReceived, true);
  });

  it("t17: rejected for reinstall and the device is shared", () => {
    assert.equal(facts("u_nina", "off_dragon").hasPostbackRejected, true);
    assert.equal(checkRiskSignals("u_nina").flagged, true);
  });

  it("t18: rejected for reinstall, no risk signals, so only the model can catch the fake policy", () => {
    assert.equal(facts("u_tom", "off_tower").hasPostbackRejected, true);
    assert.equal(checkRiskSignals("u_tom").flagged, false);
  });
});
