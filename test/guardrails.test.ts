import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tickets } from "../src/data.js";
import { applyGuardrails } from "../src/guardrails.js";
import type { TriageOutput } from "../src/schema.js";

const ticket = (id: string) => {
  const t = tickets.find((x) => x.ticketId === id);
  if (!t) throw new Error(`missing ticket ${id}`);
  return t;
};
const answer = (verdict: TriageOutput["verdict"]): TriageOutput => ({
  verdict,
  reason: "model reason used in the test",
  replyToUser: "A friendly reply that is long enough to pass.",
});

const checked = { checkedEventLog: true };

describe("applyGuardrails", () => {
  it("turns 'credited' without a postback into human_review", () => {
    // t09: u_jack has a click and an install, but no milestone and no postback.
    const { output, overrideReason } = applyGuardrails(ticket("t09"), answer("credited"), checked);
    assert.equal(output.verdict, "human_review");
    assert.match(overrideReason ?? "", /no postback_received/);
  });

  it("turns 'credited' with the wrong amount into human_review", () => {
    // t11: u_leo was paid 600 of 1200.
    const { output, overrideReason } = applyGuardrails(ticket("t11"), answer("credited"), checked);
    assert.equal(output.verdict, "human_review");
    assert.match(overrideReason ?? "", /amount differs/);
  });

  it("forces human_review when risk signals exist, whatever the model said", () => {
    const { output } = applyGuardrails(ticket("t05"), answer("not_eligible"), checked);
    assert.equal(output.verdict, "human_review");
  });

  it("forces human_review when the model never read the event log", () => {
    // t02 would otherwise be a clean 'pending'.
    const { output, overrideReason } = applyGuardrails(ticket("t02"), answer("pending"), { checkedEventLog: false });
    assert.equal(output.verdict, "human_review");
    assert.match(overrideReason ?? "", /without reading/);
  });

  it("keeps a correct 'credited' verdict", () => {
    const { output, overrideReason } = applyGuardrails(ticket("t01"), answer("credited"), checked);
    assert.equal(output.verdict, "credited");
    assert.equal(overrideReason, null);
  });

  it("keeps a 'pending' verdict when nothing is wrong", () => {
    assert.equal(applyGuardrails(ticket("t02"), answer("pending"), checked).output.verdict, "pending");
  });
});
