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

  it("rejects a reply that leaks other accounts' IDs", () => {
    const result = FinalAnswerSchema.safeParse({
      verdict: "human_review",
      reason,
      replyToUser: "Your device dev_9f3 is also used by u_eve2 and u_eve3, so a specialist will review this.",
    });
    assert.equal(result.success, false);
    assert.ok(result.error!.issues.some((i) => /internal user or device IDs/.test(i.message)));
  });

  it("rejects a reply that mentions fraud", () => {
    const result = FinalAnswerSchema.safeParse({
      verdict: "human_review",
      reason,
      replyToUser: "This looks like fraud, so we have sent it to a specialist.",
    });
    assert.equal(result.success, false);
  });

  it("rejects an unknown verdict", () => {
    const result = FinalAnswerSchema.safeParse({ verdict: "approved", reason, replyToUser: "Your coins are on the way to you." });
    assert.equal(result.success, false);
  });
});
