import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tickets, type Ticket } from "./data.js";
import { MODEL, SYSTEM_PROMPT, triageTicket, type TriageResult } from "./agent.js";
import { tools } from "./tools.js";

// Usage: npm run eval              (all tickets, once each)
//        npm run eval -- t03 t05   (a subset)
//        EVAL_RUNS=3 npm run eval  (each ticket 3 times, to spot unstable answers)
// EVAL_MIN_ACCURACY (0 to 1, default 1): the run fails below this final accuracy.
// EVAL_SAVE=0: don't write results to evals/.
const MIN_ACCURACY = Number(process.env.EVAL_MIN_ACCURACY ?? "1");
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? "1"));
const SAVE = process.env.EVAL_SAVE !== "0";
const CONCURRENCY = 3;

// Claude Opus 5.5 list prices, USD per million tokens. Other models: no estimate.
const PRICE: Record<string, { input: number; output: number }> = { "claude-opus-5-5": { input: 4, output: 20 } };

const evalsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "evals");

// Short fingerprint of everything the model is told. If it changes, scores aren't directly comparable.
const promptVersion = createHash("sha256").update(SYSTEM_PROMPT).update(JSON.stringify(tools)).digest("hex").slice(0, 8);

function gitCommit(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain -- src data", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${sha}+changes` : sha;
  } catch {
    return "unknown";
  }
}

// ---- Pick tickets ----
const only = process.argv.slice(2);
const unknown = only.filter((id) => !tickets.some((t) => t.ticketId === id));
if (unknown.length) {
  console.error(`Unknown ticket IDs: ${unknown.join(", ")}. Available: ${tickets.map((t) => t.ticketId).join(", ")}`);
  process.exit(1);
}
const selected = only.length ? tickets.filter((t) => only.includes(t.ticketId)) : tickets;

// ---- Run: one job per ticket per run ----
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

const startedAt = new Date();
console.log(`Model ${MODEL}, prompt ${promptVersion}, ${selected.length} tickets x ${RUNS} run(s)`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

if (fatal) {
  console.error(`Stopped early: ${(fatal as Error).message}`);
  process.exit(1);
}

// ---- Score ----
interface Score { correct: number; modelCorrect: number; total: number }
const blank = (): Score => ({ correct: 0, modelCorrect: 0, total: 0 });
const overall = blank();
const byGroup: Record<Ticket["group"], Score> = { core: blank(), hard: blank() };
let inTok = 0;
let outTok = 0;
const unstable: string[] = [];
const failures: string[] = [];
const rows: { t: Ticket; gotText: string; ok: number; notes: string[] }[] = [];
const records: Record<string, unknown>[] = [];

for (const t of selected) {
  const runs = results.get(t.ticketId)!;
  const got: string[] = [];
  let ok = 0;
  const notes = new Set<string>();
  runs.forEach((r, run) => {
    for (const s of [overall, byGroup[t.group]]) s.total++;
    if (r instanceof Error) {
      got.push("ERROR");
      notes.add(r.message.slice(0, 80));
      records.push({ ticketId: t.ticketId, group: t.group, run, expected: t.expectedVerdict, error: r.message });
      return;
    }
    inTok += r.usage.inputTokens;
    outTok += r.usage.outputTokens;
    got.push(r.output.verdict);
    const right = r.output.verdict === t.expectedVerdict;
    const modelRight = r.modelVerdict === t.expectedVerdict;
    if (right) ok++;
    for (const s of [overall, byGroup[t.group]]) {
      if (right) s.correct++;
      if (modelRight) s.modelCorrect++;
    }
    if (r.overrideReason) notes.add(`guardrail (model said ${r.modelVerdict ?? "-"})`);
    for (const e of r.validationErrors) notes.add(`format retry: ${e}`);
    records.push({
      ticketId: t.ticketId,
      group: t.group,
      case: t.case,
      run,
      expected: t.expectedVerdict,
      verdict: r.output.verdict,
      correct: right,
      modelVerdict: r.modelVerdict,
      overrideReason: r.overrideReason,
      reason: r.output.reason,
      replyToUser: r.output.replyToUser,
      toolCalls: r.toolCalls.map((c) => (c.ok ? c.name : `${c.name} (error)`)),
      turns: r.turns,
      formatRetries: r.formatRetries,
      validationErrors: r.validationErrors,
      tokens: r.usage,
    });
  });
  const distinct = [...new Set(got)];
  if (distinct.length > 1) unstable.push(t.ticketId);
  if (ok < runs.length) failures.push(t.ticketId);
  rows.push({ t, gotText: distinct.length === 1 ? distinct[0]! : got.join(","), ok, notes: [...notes] });
}

const pct = (s: Score, key: "correct" | "modelCorrect" = "correct") =>
  s.total ? `${s[key]}/${s.total} (${Math.round((s[key] / s.total) * 100)}%)` : "-";
const seconds = (Date.now() - startedAt.getTime()) / 1000;
const price = PRICE[MODEL];
const costUsd = price ? (inTok * price.input + outTok * price.output) / 1e6 : null;
const costText = costUsd === null ? "cost unknown for this model" : `~$${costUsd.toFixed(2)}`;
const commit = gitCommit();

// ---- Print ----
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
console.log(`${pad("ticket", 7)}${pad("group", 6)}${pad("case", 42)}${pad("expected", 14)}${pad("got", 26)}ok`);
for (const { t, gotText, ok, notes } of rows) {
  const okText = RUNS === 1 ? (ok ? "✓" : "x") : `${ok}/${RUNS}`;
  console.log(
    `${pad(t.ticketId, 7)}${pad(t.group, 6)}${pad(t.case, 42)}${pad(t.expectedVerdict, 14)}${pad(gotText, 26)}${okText}${notes.length ? "  " + notes.join("; ") : ""}`,
  );
}
console.log(`\nAccuracy (final, with guardrails): ${pct(overall)}   core ${pct(byGroup.core)} · hard ${pct(byGroup.hard)}`);
console.log(`Accuracy (model alone):           ${pct(overall, "modelCorrect")}   core ${pct(byGroup.core, "modelCorrect")} · hard ${pct(byGroup.hard, "modelCorrect")}`);
if (RUNS > 1) console.log(`Unstable tickets (answer changed between runs): ${unstable.length ? unstable.join(", ") : "none"}`);
console.log(`Tokens: ${inTok} in / ${outTok} out, ${costText}, ${seconds.toFixed(1)}s`);

// ---- Markdown report (saved to evals/latest.md and to the GitHub Actions summary) ----
const markdown = [
  `# Eval results`,
  "",
  `${startedAt.toISOString()} · model \`${MODEL}\` · prompt \`${promptVersion}\` · commit \`${commit}\` · ${RUNS} run${RUNS > 1 ? "s" : ""} per ticket`,
  "",
  "| | All | Core | Hard |",
  "|---|---|---|---|",
  `| **Final (with guardrails)** | ${pct(overall)} | ${pct(byGroup.core)} | ${pct(byGroup.hard)} |`,
  `| **Model alone** | ${pct(overall, "modelCorrect")} | ${pct(byGroup.core, "modelCorrect")} | ${pct(byGroup.hard, "modelCorrect")} |`,
  "",
  `${inTok} input / ${outTok} output tokens · ${costText} · ${seconds.toFixed(1)}s` +
    (RUNS > 1 ? ` · unstable: ${unstable.length ? unstable.join(", ") : "none"}` : ""),
  "",
  "| Ticket | Group | Case | Expected | Got | OK | Note |",
  "|---|---|---|---|---|---|---|",
  ...rows.map(
    ({ t, gotText, ok, notes }) =>
      `| ${t.ticketId} | ${t.group} | ${t.case} | ${t.expectedVerdict} | ${gotText} | ${ok === RUNS ? "✅" : ok ? "⚠️" : "❌"}${RUNS > 1 ? ` ${ok}/${RUNS}` : ""} | ${notes.join("; ").replace(/\|/g, "/")} |`,
  ),
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

// ---- Save to evals/ ----
if (SAVE) {
  const runsDir = path.join(evalsDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const runFile = path.join(runsDir, `${stamp}.json`);
  const summary = {
    finalAccuracy: overall.correct / overall.total,
    modelAccuracy: overall.modelCorrect / overall.total,
    byGroup,
    unstable,
    failures,
    tokens: { input: inTok, output: outTok },
    costUsd,
    seconds,
  };
  writeFileSync(
    runFile,
    JSON.stringify(
      { startedAt: startedAt.toISOString(), model: MODEL, promptVersion, commit, runsPerTicket: RUNS, tickets: selected.map((t) => t.ticketId), summary, results: records },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(evalsDir, "latest.md"), markdown);

  const historyFile = path.join(evalsDir, "history.csv");
  if (!existsSync(historyFile)) {
    writeFileSync(historyFile, "date,model,prompt,commit,tickets,runs,final,model_alone,core,hard,unstable,cost_usd,file\n");
  }
  const ratio = (s: Score) => (s.total ? (s.correct / s.total).toFixed(3) : "");
  appendFileSync(
    historyFile,
    [
      startedAt.toISOString(),
      MODEL,
      promptVersion,
      commit,
      selected.length,
      RUNS,
      ratio(overall),
      (overall.modelCorrect / overall.total).toFixed(3),
      ratio(byGroup.core),
      ratio(byGroup.hard),
      `"${unstable.join(" ")}"`,
      costUsd === null ? "" : costUsd.toFixed(2),
      `runs/${path.basename(runFile)}`,
    ].join(",") + "\n",
  );
  console.log(`\nSaved evals/runs/${path.basename(runFile)}, evals/latest.md, evals/history.csv`);
}

const passed = overall.correct / overall.total >= MIN_ACCURACY;
if (!passed) console.log(`\nFAILED: accuracy below the required ${Math.round(MIN_ACCURACY * 100)}%`);
process.exitCode = passed ? 0 : 1;
