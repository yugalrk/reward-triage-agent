import { appendFileSync } from "node:fs";
import { tickets } from "./data.js";
import { triageTicket, type TriageResult } from "./agent.js";

// The run fails if final accuracy is below this (0 to 1). Default: every ticket correct.
const MIN_ACCURACY = Number(process.env.EVAL_MIN_ACCURACY ?? "1");

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
const summaryRows: string[] = [];

console.log(`${pad("ticket", 7)}${pad("case", 44)}${pad("expected", 14)}${pad("got", 14)}ok`);
for (const t of selected) {
  const r = results.get(t.ticketId)!;
  if (r instanceof Error) {
    console.log(`${pad(t.ticketId, 7)}${pad(t.case, 44)}${pad(t.expectedVerdict, 14)}${pad("ERROR", 14)}x  ${r.message}`);
    summaryRows.push(`| ${t.ticketId} | ${t.case} | ${t.expectedVerdict} | ERROR | ❌ | ${r.message.replace(/\|/g, "/")} |`);
    continue;
  }
  inTok += r.usage.inputTokens;
  outTok += r.usage.outputTokens;
  const ok = r.output.verdict === t.expectedVerdict;
  if (ok) correct++;
  if (r.modelVerdict === t.expectedVerdict) modelCorrect++;
  const note = r.overrideReason ? `  (guardrail: model said ${r.modelVerdict ?? "-"})` : "";
  console.log(`${pad(t.ticketId, 7)}${pad(t.case, 44)}${pad(t.expectedVerdict, 14)}${pad(r.output.verdict, 14)}${ok ? "✓" : "x"}${note}`);
  summaryRows.push(
    `| ${t.ticketId} | ${t.case} | ${t.expectedVerdict} | ${r.output.verdict} | ${ok ? "✅" : "❌"} | ${r.overrideReason ? `guardrail (model said ${r.modelVerdict ?? "-"})` : ""} |`,
  );
}

const n = selected.length;
const pct = (k: number) => `${k}/${n} (${Math.round((k / n) * 100)}%)`;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nAccuracy (final, with guardrails): ${pct(correct)}`);
console.log(`Accuracy (model alone):           ${pct(modelCorrect)}`);
console.log(`Tokens: ${inTok} in / ${outTok} out, ${seconds}s`);

// On GitHub Actions, also write a table to the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Eval results",
      "",
      `**Final accuracy:** ${pct(correct)} · **Model alone:** ${pct(modelCorrect)} · ${inTok} in / ${outTok} out tokens · ${seconds}s`,
      "",
      "| Ticket | Case | Expected | Got | OK | Note |",
      "|---|---|---|---|---|---|",
      ...summaryRows,
      "",
    ].join("\n"),
  );
}

const passed = correct / n >= MIN_ACCURACY;
if (!passed) console.log(`\nFAILED: accuracy below the required ${Math.round(MIN_ACCURACY * 100)}%`);
process.exitCode = passed ? 0 : 1;
