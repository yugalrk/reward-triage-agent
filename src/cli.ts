import { tickets } from "./data.js";
import { triageTicket } from "./agent.js";

// Usage: npm run triage -- t04
//        npm run triage -- --user u_bob --offer off_farm "I finished chapter 5 but got nothing"
const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const user = flag("--user");
const offer = flag("--offer");

const ticket =
  user && offer
    ? {
        ticketId: "adhoc",
        userId: user,
        offerId: offer,
        message: args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")).join(" ") || "I didn't get my coins.",
        expectedVerdict: "human_review" as const,
        case: "ad hoc",
      }
    : tickets.find((t) => t.ticketId === (args[0] ?? "t01"));

if (!ticket) {
  console.error(`Unknown ticket. Available: ${tickets.map((t) => t.ticketId).join(", ")}`);
  process.exit(1);
}

console.log(`Ticket ${ticket.ticketId} (${ticket.userId}, ${ticket.offerId})`);
console.log(`"${ticket.message}"\n`);

const result = await triageTicket(ticket, { verbose: true });

console.log(`\nVerdict:  ${result.output.verdict}`);
if (result.overrideReason) console.log(`Override: ${result.overrideReason} (model said ${result.modelVerdict ?? "nothing valid"})`);
console.log(`Reason:   ${result.output.reason}`);
console.log(`Reply:    ${result.output.replyToUser}`);
console.log(
  `\n${result.toolCalls.length} tool calls, ${result.turns} turns, ${result.formatRetries} format retries, ` +
    `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`,
);
