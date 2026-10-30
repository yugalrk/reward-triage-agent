import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { events, offers, REFERENCE_NOW, type UserEvent } from "./data.js";

const HOUR = 3_600_000;
const hoursBetween = (a: string | Date, b: string | Date) =>
  Math.round(((new Date(b).getTime() - new Date(a).getTime()) / HOUR) * 10) / 10;

const firstOf = (list: UserEvent[], type: UserEvent["type"]) => list.find((e) => e.type === type);

// ---- Tool 1: the user's event log for one offer, plus a few derived numbers ----
export function getUserEvents(userId: string, offerId: string) {
  const list = events
    .filter((e) => e.userId === userId && e.offerId === offerId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const click = firstOf(list, "click");
  const install = firstOf(list, "install");
  const milestone = firstOf(list, "milestone_reached");

  return {
    userId,
    offerId,
    now: REFERENCE_NOW.toISOString(),
    events: list,
    summary: {
      eventCount: list.length,
      installCount: list.filter((e) => e.type === "install").length,
      installBeforeClick: !!(click && install && install.timestamp < click.timestamp),
      daysFromClickToMilestone: click && milestone ? hoursBetween(click.timestamp, milestone.timestamp) / 24 : null,
      hoursSinceMilestone: milestone ? hoursBetween(milestone.timestamp, REFERENCE_NOW) : null,
      hasPostbackReceived: list.some((e) => e.type === "postback_received"),
      hasPostbackRejected: list.some((e) => e.type === "postback_rejected"),
    },
  };
}

// ---- Tool 2: the rules of an offer ----
export function getOfferRules(offerId: string) {
  const offer = offers.find((o) => o.offerId === offerId);
  if (!offer) return { error: `Unknown offerId: ${offerId}` };
  return offer;
}

// ---- Tool 3: fraud / risk signals for a user ----
const MAX_ACCOUNTS_PER_DEVICE = 2;

export function checkRiskSignals(userId: string) {
  const signals: string[] = [];
  const userEvents = events.filter((e) => e.userId === userId);
  const devices = [...new Set(userEvents.map((e) => e.deviceId))];

  for (const deviceId of devices) {
    const accounts = [...new Set(events.filter((e) => e.deviceId === deviceId).map((e) => e.userId))];
    if (accounts.length > MAX_ACCOUNTS_PER_DEVICE) {
      signals.push(`multi_account_device: ${accounts.length} accounts on device ${deviceId} (${accounts.join(", ")})`);
    }
  }

  for (const offer of offers) {
    const mine = userEvents.filter((e) => e.offerId === offer.offerId);
    const install = firstOf(mine, "install");
    const milestone = firstOf(mine, "milestone_reached");
    if (!install || !milestone) continue;
    const minutes = Math.round(hoursBetween(install.timestamp, milestone.timestamp) * 60);
    if (minutes < offer.minPlausibleMinutes) {
      signals.push(
        `impossible_speed: ${offer.offerId} milestone reached ${minutes} min after install (plausible minimum ${offer.minPlausibleMinutes} min)`,
      );
    }
  }

  return { userId, flagged: signals.length > 0, signals };
}

// ---- Tool definitions sent to Claude ----
export const tools: Anthropic.Tool[] = [
  {
    name: "getUserEvents",
    description:
      "Returns the user's tracking events for one offer (click, install, milestone_reached, postback_received, postback_rejected) in time order, plus a summary with derived timings. 'now' is the current time to measure against.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { userId: { type: "string" }, offerId: { type: "string" } },
      required: ["userId", "offerId"],
      additionalProperties: false,
    },
  },
  {
    name: "getOfferRules",
    description:
      "Returns the offer's rules: game, milestone, reward in coins, deadline in days counted from the click, the advertiser's typical confirmation time in hours, and the fastest plausible completion time.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { offerId: { type: "string" } },
      required: ["offerId"],
      additionalProperties: false,
    },
  },
  {
    name: "checkRiskSignals",
    description:
      "Checks a user for fraud signals, such as many accounts on one device or finishing a milestone impossibly fast. Returns flagged=true with a list of signals if anything looks suspicious.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { userId: { type: "string" } },
      required: ["userId"],
      additionalProperties: false,
    },
  },
];

// ---- Dispatcher: validate the model's input with zod, then run the tool ----
const inputs = {
  getUserEvents: z.object({ userId: z.string(), offerId: z.string() }),
  getOfferRules: z.object({ offerId: z.string() }),
  checkRiskSignals: z.object({ userId: z.string() }),
};

export type ToolName = keyof typeof inputs;

export function executeTool(name: string, rawInput: unknown): unknown {
  switch (name) {
    case "getUserEvents": {
      const i = inputs.getUserEvents.parse(rawInput);
      return getUserEvents(i.userId, i.offerId);
    }
    case "getOfferRules":
      return getOfferRules(inputs.getOfferRules.parse(rawInput).offerId);
    case "checkRiskSignals":
      return checkRiskSignals(inputs.checkRiskSignals.parse(rawInput).userId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
