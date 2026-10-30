import { z } from "zod";
import { VerdictSchema } from "./data.js";

// Shape sent to the API as the required output format.
export const TriageOutputSchema = z.object({
  verdict: VerdictSchema,
  reason: z.string(),
  replyToUser: z.string(),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

// Extra checks that a JSON schema can't express. A failure here triggers one retry.
const PROMISES_COINS = /\b(i|we)('ve| have| will|'ll)? (added|credited|sent|transferred|deposited|add|credit)\b.*\bcoins?\b/i;

export const FinalAnswerSchema = TriageOutputSchema.superRefine((out, ctx) => {
  if (out.reason.trim().length < 15) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "reason is too short to audit" });
  }
  if (out.replyToUser.trim().length < 20) {
    ctx.addIssue({ code: "custom", path: ["replyToUser"], message: "replyToUser is too short" });
  }
  if (out.verdict !== "credited" && PROMISES_COINS.test(out.replyToUser)) {
    ctx.addIssue({
      code: "custom",
      path: ["replyToUser"],
      message: "replyToUser promises to add coins, but the agent cannot give coins",
    });
  }
});
