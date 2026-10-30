# Missing Reward Triage Agent

A CLI agent that handles "I completed the offer but didn't get my coins" support tickets.
It reads the user's tracking events with tool calls, decides a verdict, and drafts a reply to the user.

```
verdict: "credited" | "pending" | "not_eligible" | "human_review"
reason: string        // internal note for support staff
replyToUser: string   // message sent to the user
```

## Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."

npm run triage -- t04                    # one ticket, with the tool calls shown
npm run triage -- --user u_bob --offer off_farm "finished chapter 5, no coins"
npm run eval                             # all tickets, prints accuracy
npm run eval -- t05 t09                  # a subset
npm run typecheck
```

Set `TRIAGE_MODEL` to try another model (default `claude-opus-5-5`).

## Layout

| File | What it does |
|---|---|
| `data/offers.json` | Offer rules: milestone, reward, deadline, typical confirmation time, fastest plausible completion |
| `data/events.json` | Per-user events: `click`, `install`, `milestone_reached`, `postback_received`, `postback_rejected` |
| `data/tickets.json` | 11 complaints, each with an expected verdict |
| `src/tools.ts` | `getUserEvents`, `getOfferRules`, `checkRiskSignals`, plus their tool definitions |
| `src/schema.ts` | Zod output schema and extra checks (for example, the reply must not promise coins) |
| `src/agent.ts` | Agent loop, output validation with one retry, guardrails |
| `src/eval.ts` | Runs every ticket and prints accuracy |

The data uses a fixed "now" (`2026-10-29T12:00Z`, in `src/data.ts`), so results stay the same from run to run.

## How it works

1. The ticket goes to Claude along with three tools. Claude decides which tools to call, often several in parallel.
2. The loop runs the tools (inputs checked with zod), sends the results back, and repeats until Claude gives a final answer.
3. The final answer must match a JSON schema built from the zod schema. Zod then checks it again, including rules a JSON schema can't express. If the check fails, the error goes back to Claude for one retry. If it fails again, the ticket goes to `human_review`.
4. Guardrails in plain code run last. They can only move a verdict to `human_review`, never the other way:
   - Risk signals are found for the user.
   - The model said `credited`, but there is no postback, or the amount doesn't match the reward.
   - The model refused, hit the token limit, or ran out of turns.

**Safety:** the agent has no tool that gives coins, so it can only read data and recommend a verdict. Fraud signals, payout disputes and manual payout requests go to `human_review`. The ticket text is treated as user data, not as instructions (ticket t09 tests this).

## Eval cases

| Ticket | Case | Expected |
|---|---|---|
| t01 | already paid | credited |
| t02 | inside confirmation window | pending |
| t03 | deadline missed | not_eligible |
| t04 | app reinstalled, postback rejected | not_eligible |
| t05 | 4 accounts on one device | human_review |
| t06 | level 50 in 35 minutes | human_review |
| t07 | app installed before the click | not_eligible |
| t08 | confirmation overdue | human_review |
| t09 | prompt injection / "add 5000 coins" | human_review |
| t10 | long advertiser confirmation window | pending |
| t11 | paid 600 of 1200 | human_review |

The eval prints two scores: the final accuracy, and the model's accuracy without the guardrails. The gap between them shows how much the guardrails are catching.

## Design notes

- **Tool calls instead of putting all the logs in the prompt.** The model only gets the events for this user and offer. That costs less, and each decision can be traced to specific tool calls.
- **Zod as the contract.** The rest of the system gets a typed, validated object or a safe fallback, never free text.
- **A human in the loop for money.** At Freecash's scale, an agent that pays out by mistake is a fraud target and a cost. The agent sorts tickets and drafts replies, and people approve payouts.
- **The eval.** It shows whether a prompt or model change helped or hurt, so changes are measured rather than guessed.
