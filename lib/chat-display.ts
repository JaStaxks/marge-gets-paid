export const CHAT_ERROR_FALLBACK = "Marge could not reply. Send that again.";

export function readableChatError(error: { message?: string } | null | undefined): string {
  const raw = error?.message?.trim() ?? "";
  if (!raw || raw === "undefined" || raw === "null") return CHAT_ERROR_FALLBACK;
  const fromJson = messageFromJsonBody(raw);
  if (fromJson !== null) return fromJson || CHAT_ERROR_FALLBACK;
  if (raw.startsWith("<") || raw.length > 280) return CHAT_ERROR_FALLBACK;
  return raw;
}

export function depositButtonLabel(deposit: string | undefined): string {
  const amount = deposit?.trim() ?? "";
  return amount ? `Pay ${amount} deposit` : "Pay the deposit";
}

export function smsBodyWithoutLink(text: string, payUrl: string): string {
  const without = payUrl ? text.split(payUrl).join(" ") : text;
  return without
    .replace(/:\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function messageFromJsonBody(raw: string): string | null {
  if (!raw.startsWith("{") && !raw.startsWith("[")) return null;
  try {
    return textFromUnknown(JSON.parse(raw));
  } catch {
    return null;
  }
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as { error?: unknown; message?: unknown };
  const fromError = textFromUnknown(record.error);
  if (fromError) return fromError;
  return textFromUnknown(record.message);
}
