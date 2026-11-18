import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync } from "node:fs";
import { tickets } from "./data.js";
import { MODEL, triageTicket, type TriageResult } from "./agent.js";

// Usage: npm run eval              (all tickets, once each)
//        npm run eval -- t03 t05   (a subset)
//        EVAL_RUNS=3 npm run eval  (each ticket 3 times, to spot unstable answers)
// The run fails if final accuracy is below EVAL_MIN_ACCURACY (0 to 1, default 1).
const MIN_ACCURACY = Number(process.env.EVAL_MIN_ACCURACY ?? "1");
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? "1"));
const CONCURRENCY = 3;

// Claude Opus 5.5 list prices, USD per million tokens. Other models: no estimate.
const PRICE: Record<string, { input: number; output: number }> = { "claude-opus-5-5": { input: 4, output: 20 } };

const only = process.argv.slice(2);
const unknown = only.filter((id) => !tickets.some((t) => t.ticketId === id));
if (unknown.length) {
  console.error(`Unknown ticket IDs: ${unknown.join(", ")}. Available: ${tickets.map((t) => t.ticketId).join(", ")}`);
  process.exit(1);
}
const selected = only.length ? tickets.filter((t) => only.includes(t.ticketId)) : tickets;

// One job per ticket per run.
const jobs = selected.flatMap((t) => Array.from({ length: RUNS }, () => t));
const results = new Map<string, (TriageResult | Error)[]>(selected.map((t) => [t.ticketId, []]));

// Stop everything on errors that would hit every ticket (bad key, no credits, unknown model).
let fatal: Error | null = null;
const isFatal = (err: unknown) => err instanceof Anthropic.APIError && [400, 401, 403, 404].includes(err.status ?? 0);

let next = 0;
async function worker() {
  while (next < jobs.length && !fatal) {
    const t = jobs[next++]!;
    try {
      results.get(t.ticketId)!.push(await triageTicket(t));
      process.stdout.write(".");
    } catch (err) {
      if (isFatal(err)) fatal = err as Error;
      results.get(t.ticketId)!.push(err as Error);
      process.stdout.write("E");
    }
  }
}

console.log(`Model ${MODEL}, ${selected.length} tickets x ${RUNS} run(s)`);
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

if (fatal) {
  console.error(`Stopped early: ${(fatal as Error).message}`);
  process.exit(1);
}

let correct = 0;
let modelCorrect = 0;
let total = 0;
let inTok = 0;
let outTok = 0;
const unstable: string[] = [];
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const summaryRows: string[] = [];

console.log(`${pad("ticket", 7)}${pad("case", 44)}${pad("expected", 14)}${pad("got", 28)}ok`);
for (const t of selected) {
  const runs = results.get(t.ticketId)!;
  const got: string[] = [];
  let ok = 0;
  const notes = new Set<string>();
  for (const r of runs) {
    total++;
    if (r instanceof Error) {
      got.push("ERROR");
      notes.add(r.message.slice(0, 80));
      continue;
    }
    inTok += r.usage.inputTokens;
    outTok += r.usage.outputTokens;
    got.push(r.output.verdict);
    if (r.output.verdict === t.expectedVerdict) ok++;
    if (r.modelVerdict === t.expectedVerdict) modelCorrect++;
    if (r.overrideReason) notes.add(`guardrail (model said ${r.modelVerdict ?? "-"})`);
    if (r.formatRetries) notes.add(`${r.formatRetries} format retry`);
  }
  correct += ok;
  const distinct = [...new Set(got)];
  if (distinct.length > 1) unstable.push(t.ticketId);
  const gotText = distinct.length === 1 ? distinct[0]! : got.join(",");
  const okText = RUNS === 1 ? (ok ? "✓" : "x") : `${ok}/${RUNS}`;
  const note = notes.size ? `  ${[...notes].join("; ")}` : "";
  console.log(`${pad(t.ticketId, 7)}${pad(t.case, 44)}${pad(t.expectedVerdict, 14)}${pad(gotText, 28)}${okText}${note}`);
  summaryRows.push(
    `| ${t.ticketId} | ${t.case} | ${t.expectedVerdict} | ${gotText} | ${ok === RUNS ? "✅" : ok ? "⚠️" : "❌"} ${RUNS > 1 ? `${ok}/${RUNS}` : ""} | ${[...notes].join("; ").replace(/\|/g, "/")} |`,
  );
}

const pct = (k: number) => `${k}/${total} (${Math.round((k / total) * 100)}%)`;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const price = PRICE[MODEL];
const cost = price ? `~$${((inTok * price.input + outTok * price.output) / 1e6).toFixed(2)}` : "cost unknown for this model";

console.log(`\nAccuracy (final, with guardrails): ${pct(correct)}`);
console.log(`Accuracy (model alone):           ${pct(modelCorrect)}`);
if (RUNS > 1) console.log(`Unstable tickets (answer changed between runs): ${unstable.length ? unstable.join(", ") : "none"}`);
console.log(`Tokens: ${inTok} in / ${outTok} out, ${cost}, ${seconds}s`);

// On GitHub Actions, also write a table to the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `## Eval results (${MODEL}, ${RUNS} run${RUNS > 1 ? "s" : ""} per ticket)`,
      "",
      `**Final accuracy:** ${pct(correct)} · **Model alone:** ${pct(modelCorrect)} · ${inTok} in / ${outTok} out tokens · ${cost} · ${seconds}s`,
      RUNS > 1 ? `\n**Unstable tickets:** ${unstable.length ? unstable.join(", ") : "none"}` : "",
      "",
      "| Ticket | Case | Expected | Got | OK | Note |",
      "|---|---|---|---|---|---|",
      ...summaryRows,
      "",
    ].join("\n"),
  );
}

const passed = correct / total >= MIN_ACCURACY;
if (!passed) console.log(`\nFAILED: accuracy below the required ${Math.round(MIN_ACCURACY * 100)}%`);
process.exitCode = passed ? 0 : 1;
