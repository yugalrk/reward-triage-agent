import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FinalAnswerSchema } from "../src/schema.js";

const reason = "Milestone reached 16h ago, confirmation window is 24h, no postback yet.";

describe("FinalAnswerSchema", () => {
  it("rejects a pending reply that promises coins", () => {
    const result = FinalAnswerSchema.safeParse({
      verdict: "pending",
      reason,
      replyToUser: "Good news, we've added 800 coins to your account for Farm Story Saga!",
    });
    assert.equal(result.success, false);
    assert.ok(result.error!.issues.some((i) => i.path[0] === "replyToUser" && /promises to add coins/.test(i.message)));
  });

  it("accepts a pending reply that only explains the wait", () => {
    const result = FinalAnswerSchema.safeParse({
      verdict: "pending",
      reason,
      replyToUser: "Thanks for checking in! The game usually confirms within 24 hours, so your reward should show up soon.",
    });
    assert.equal(result.success, true);
  });

  it("rejects an unknown verdict", () => {
    const result = FinalAnswerSchema.safeParse({ verdict: "approved", reason, replyToUser: "Your coins are on the way to you." });
    assert.equal(result.success, false);
  });
});
