import type { Slot } from "@/lib/types";

const OPEN_HOURS = [8, 9, 11, 13, 15];

function laParts(date: Date): {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: string;
  minute: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year ?? "",
    month: parts.month ?? "",
    day: parts.day ?? "",
    weekday: parts.weekday ?? "",
    hour: parts.hour ?? "00",
    minute: parts.minute ?? "00",
  };
}

export function generateSlots(now = new Date()): Slot[] {
  const slots: Slot[] = [];
  const cursor = new Date(now);
  cursor.setUTCMinutes(0, 0, 0);
  cursor.setUTCHours(cursor.getUTCHours() + 1);
  const end = now.getTime() + 12 * 24 * 60 * 60 * 1000;
  for (let time = cursor.getTime(); time < end; time += 60 * 60 * 1000) {
    const date = new Date(time);
    if (date.getTime() < now.getTime() + 60 * 60 * 1000) continue;
    const parts = laParts(date);
    if (parts.minute !== "00") continue;
    if (parts.weekday === "Sat" || parts.weekday === "Sun") continue;
    const hour = Number(parts.hour);
    if (!OPEN_HOURS.includes(hour)) continue;
    slots.push({
      id: `slot_${parts.year}${parts.month}${parts.day}_${String(hour).padStart(2, "0")}00`,
      startsAt: date.toISOString(),
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date),
      weekday: parts.weekday,
      hour,
      available: true,
    });
  }
  return slots;
}

export function slotsForModel(slots: Slot[]): Array<{ id: string; label: string }> {
  const open = slots.filter((slot) => slot.available);
  const preferred = open.find((slot) => slot.weekday === "Tue" && slot.hour === 9);
  const head = open.slice(0, 8);
  if (preferred && !head.some((slot) => slot.id === preferred.id)) head.push(preferred);
  return head.map((slot) => ({ id: slot.id, label: slot.label }));
}

const WEEKDAY_ALIASES: Record<string, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  tues: "Tue",
  wed: "Wed",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  fri: "Fri",
};

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slotDay(slot: Slot): number | undefined {
  const date = /^slot_(\d{4})(\d{2})(\d{2})_/.exec(slot.id);
  if (!date) return undefined;
  return Number(date[3]);
}

function looseSlot(slots: Slot[], query: string): Slot | undefined {
  const lower = query.toLowerCase();
  let weekday: string | undefined;
  for (const [alias, short] of Object.entries(WEEKDAY_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) weekday = short;
  }
  const time = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  let hour: number | undefined;
  if (time) {
    hour = Number(time[1]);
    if (time[3] === "pm" && hour < 12) hour += 12;
    if (time[3] === "am" && hour === 12) hour = 0;
  }
  const monthDay = lower.match(
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/,
  );
  const day = monthDay ? Number(monthDay[1]) : undefined;
  if (!weekday && hour === undefined && day === undefined) return undefined;
  const matches = slots.filter((slot) => {
    if (weekday && slot.weekday !== weekday) return false;
    if (hour !== undefined && slot.hour !== hour) return false;
    if (day !== undefined && slotDay(slot) !== day) return false;
    return true;
  });
  return matches.find((slot) => slot.available) ?? matches[0];
}

export function matchSlot(slots: Slot[], query: string): Slot | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const exact = slots.find((slot) => slot.id === trimmed);
  if (exact) return exact;
  const wanted = compact(trimmed);
  const byLabel = slots.find((slot) => compact(slot.label) === wanted || compact(slot.id) === wanted);
  if (byLabel) return byLabel;
  return looseSlot(slots, trimmed);
}
