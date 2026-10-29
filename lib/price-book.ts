import { depositCentsFor } from "@/lib/money";
import type { PriceBookItem } from "@/lib/types";

export const PRICE_BOOK: PriceBookItem[] = [
  {
    code: "ac-diagnostic",
    name: "AC diagnostic",
    summary: "Coastal AC not cooling, short cycling, or blowing warm.",
    priceCents: 8900,
    deposit: { type: "flat", cents: 4900 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "ac-tune",
    name: "AC tune-up",
    summary: "Seasonal condenser and air-handler service.",
    priceCents: 18900,
    deposit: { type: "percent", bps: 2500 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "ac-capacitor",
    name: "Run capacitor replacement",
    summary: "Common failure on salt-air condensers.",
    priceCents: 24500,
    deposit: { type: "percent", bps: 2500 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "wh-leak",
    name: "Water heater leak diagnostic",
    summary: "Tank, fittings, or T&P valve leaking. Visit price before parts.",
    priceCents: 8900,
    deposit: { type: "flat", cents: 4900 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "wh-flush",
    name: "Water heater flush",
    summary: "Drain and flush sediment from a tank heater.",
    priceCents: 14900,
    deposit: { type: "flat", cents: 4900 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "wh-anode",
    name: "Anode rod replacement",
    summary: "Pull and replace the sacrificial anode.",
    priceCents: 28900,
    deposit: { type: "percent", bps: 2500 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "drain-clear",
    name: "Drain clear",
    summary: "Kitchen or bath drain snaked from the accessible cleanout.",
    priceCents: 12900,
    deposit: { type: "flat", cents: 4900 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "faucet",
    name: "Faucet repair",
    summary: "Cartridge, supply, or spray-hose repair.",
    priceCents: 17500,
    deposit: { type: "percent", bps: 2500 },
    unit: "QUANTITY",
    bookable: true,
  },
  {
    code: "labor-hour",
    name: "Technician labor",
    summary: "On-site labor billed after the visit.",
    priceCents: 16500,
    deposit: { type: "none" },
    unit: "HOURS",
    bookable: false,
  },
  {
    code: "service-call",
    name: "Service call",
    summary: "Dispatch when the note does not match a listed repair.",
    priceCents: 8900,
    deposit: { type: "flat", cents: 4900 },
    unit: "QUANTITY",
    bookable: true,
  },
];

const byCode = new Map(PRICE_BOOK.map((item) => [item.code, item]));

export function getPriceBookItem(code: string): PriceBookItem | undefined {
  return byCode.get(code);
}

export function requirePriceBookItem(code: string): PriceBookItem {
  const item = getPriceBookItem(code);
  if (!item) {
    throw new Error(`Unknown price book code: ${code}`);
  }
  return item;
}

export function bookableServices(): PriceBookItem[] {
  return PRICE_BOOK.filter((item) => item.bookable);
}

export function matchService(text: string): PriceBookItem {
  const note = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/anode/, "wh-anode"],
    [/flush/, "wh-flush"],
    [/water heater|hot water|tankless|tank heater/, "wh-leak"],
    [/drain|clog|slow drain|backed up/, "drain-clear"],
    [/faucet|tap\b|sink leak/, "faucet"],
    [/capacitor/, "ac-capacitor"],
    [/tune[- ]?up|maintenance/, "ac-tune"],
    [/ac\b|a\/c|air condition|not cooling|no cool|hvac|condenser/, "ac-diagnostic"],
    [/leak/, "wh-leak"],
  ];
  for (const [pattern, code] of rules) {
    if (pattern.test(note)) return requirePriceBookItem(code);
  }
  return requirePriceBookItem("service-call");
}

export function priceBookForPrompt(): string {
  return PRICE_BOOK.map((item) => {
    const deposit =
      item.deposit.type === "flat"
        ? `booking deposit ${depositCentsFor(item) / 100} USD flat`
        : item.deposit.type === "percent"
          ? "booking deposit 25%"
          : "invoice only";
    return `- ${item.code}: ${item.name} (${item.unit === "HOURS" ? "per hour" : "each"}), ${deposit}. ${item.summary}`;
  }).join("\n");
}

export type NoteLine = { code: string; quantity: number };

export function linesFromNote(note: string): NoteLine[] {
  const text = note.toLowerCase();
  const lines: NoteLine[] = [];
  const push = (code: string, quantity = 1) => {
    if (!lines.some((line) => line.code === code)) lines.push({ code, quantity });
  };
  if (/anode/.test(text)) push("wh-anode");
  if (/flush/.test(text)) push("wh-flush");
  if (/capacitor/.test(text)) push("ac-capacitor");
  if (/tune/.test(text)) push("ac-tune");
  if (/drain|clog/.test(text)) push("drain-clear");
  if (/faucet/.test(text)) push("faucet");
  if (/not cooling|no cool|diagnostic/.test(text)) push("ac-diagnostic");
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr)\b/);
  if (hours) push("labor-hour", Number(hours[1]));
  if (lines.length === 0) push("service-call");
  return lines;
}
