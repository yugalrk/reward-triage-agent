import { tickets } from "./data.js";
import { triageTicket, type TriageResult } from "./agent.js";

// Usage: npm run eval            (all tickets)
//        npm run eval -- t03 t05 (a subset)
const only = process.argv.slice(2);
const selected = only.length ? tickets.filter((t) => only.includes(t.ticketId)) : tickets;
const CONCURRENCY = 3;

const results = new Map<string, TriageResult | Error>();
let next = 0;
async function worker() {
  while (next < selected.length) {
    const t = selected[next++]!;
    try {
      results.set(t.ticketId, await triageTicket(t));
    } catch (err) {
      results.set(t.ticketId, err as Error);
    }
    process.stdout.write(".");
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

let correct = 0;
let modelCorrect = 0;
let inTok = 0;
let outTok = 0;
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

console.log(`${pad("ticket", 7)}${pad("case", 44)}${pad("expected", 14)}${pad("got", 14)}ok`);
for (const t of selected) {
  const r = results.get(t.ticketId)!;
  if (r instanceof Error) {
    console.log(`${pad(t.ticketId, 7)}${pad(t.case, 44)}${pad(t.expectedVerdict, 14)}${pad("ERROR", 14)}x  ${r.message}`);
    continue;
  }
  inTok += r.usage.inputTokens;
  outTok += r.usage.outputTokens;
  const ok = r.output.verdict === t.expectedVerdict;
  if (ok) correct++;
  if (r.modelVerdict === t.expectedVerdict) modelCorrect++;
  const note = r.overrideReason ? `  (guardrail: model said ${r.modelVerdict ?? "-"})` : "";
  console.log(`${pad(t.ticketId, 7)}${pad(t.case, 44)}${pad(t.expectedVerdict, 14)}${pad(r.output.verdict, 14)}${ok ? "✓" : "x"}${note}`);
}

const n = selected.length;
console.log(`\nAccuracy (final, with guardrails): ${correct}/${n} (${Math.round((correct / n) * 100)}%)`);
console.log(`Accuracy (model alone):           ${modelCorrect}/${n} (${Math.round((modelCorrect / n) * 100)}%)`);
console.log(`Tokens: ${inTok} in / ${outTok} out, ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exitCode = correct === n ? 0 : 1;
