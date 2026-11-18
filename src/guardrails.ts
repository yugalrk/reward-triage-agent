import { events, offers, type Ticket } from "./data.js";
import type { TriageOutput } from "./schema.js";
import { checkRiskSignals } from "./tools.js";

export const ESCALATION_REPLY =
  "Thanks for reaching out. We've passed your request to a specialist on our team, who will check your offer and get back to you. Please don't redo the offer in the meantime.";

// Deterministic checks that run after the model. They can only make a verdict
// more careful (move it to human_review), never give coins.
export function applyGuardrails(ticket: Ticket, out: TriageOutput): { output: TriageOutput; overrideReason: string | null } {
  const escalate = (why: string) => ({
    output: { verdict: "human_review" as const, reason: `[guardrail] ${why} | model said: ${out.verdict}: ${out.reason}`, replyToUser: ESCALATION_REPLY },
    overrideReason: why,
  });
  if (out.verdict === "human_review") return { output: out, overrideReason: null };

  const risk = checkRiskSignals(ticket.userId);
  if (risk.flagged) return escalate(`risk signals present: ${risk.signals.join("; ")}`);

  if (out.verdict === "credited") {
    const offer = offers.find((o) => o.offerId === ticket.offerId);
    const paid = events.find((e) => e.userId === ticket.userId && e.offerId === ticket.offerId && e.type === "postback_received");
    if (!paid) return escalate("model said credited but there is no postback_received event");
    if (offer && paid.payoutCoins !== offer.rewardCoins) return escalate("paid amount differs from offer reward");
  }
  return { output: out, overrideReason: null };
}
