import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// Fixed "now" so the mock data and the eval give the same answers on every run.
export const REFERENCE_NOW = new Date("2026-10-29T12:00:00Z");

export const OfferSchema = z.object({
  offerId: z.string(),
  game: z.string(),
  milestone: z.string(),
  rewardCoins: z.number(),
  deadlineDays: z.number(),
  typicalConfirmationHours: z.number(),
  minPlausibleMinutes: z.number(),
});

export const EventSchema = z.object({
  userId: z.string(),
  offerId: z.string(),
  type: z.enum(["click", "install", "milestone_reached", "postback_received", "postback_rejected"]),
  timestamp: z.string(),
  deviceId: z.string(),
  payoutCoins: z.number().optional(),
  rejectReason: z.string().optional(),
});

export const VerdictSchema = z.enum(["credited", "pending", "not_eligible", "human_review"]);

export const TicketSchema = z.object({
  ticketId: z.string(),
  userId: z.string(),
  offerId: z.string(),
  message: z.string(),
  expectedVerdict: VerdictSchema,
  case: z.string(),
});

export type Offer = z.infer<typeof OfferSchema>;
export type UserEvent = z.infer<typeof EventSchema>;
export type Ticket = z.infer<typeof TicketSchema>;

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const raw = JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
  return z.array(schema).parse(raw);
}

export const offers = load("offers.json", OfferSchema);
export const events = load("events.json", EventSchema);
export const tickets = load("tickets.json", TicketSchema);
