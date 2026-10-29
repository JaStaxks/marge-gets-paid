import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { geminiApiKey, geminiModel, hasGemini } from "@/lib/env";

export function geminiReady(): boolean {
  return hasGemini();
}

export function geminiLanguageModel() {
  const google = createGoogleGenerativeAI({ apiKey: geminiApiKey() });
  return google(geminiModel());
}

function quotaText(error: unknown, depth = 0): string[] {
  if (error == null || depth > 4) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [String(error)];
  const record = error as {
    message?: unknown;
    responseBody?: unknown;
    data?: unknown;
    lastError?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const lines: string[] = [];
  if (typeof record.message === "string") lines.push(record.message);
  if (typeof record.responseBody === "string") lines.push(record.responseBody);
  if (record.data !== undefined) {
    try {
      lines.push(typeof record.data === "string" ? record.data : JSON.stringify(record.data));
    } catch {
      lines.push("");
    }
  }
  lines.push(...quotaText(record.lastError, depth + 1));
  lines.push(...quotaText(record.cause, depth + 1));
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) lines.push(...quotaText(item, depth + 1));
  }
  return lines;
}

export function isGeminiQuotaError(error: unknown): boolean {
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|generate_content_free_tier/i.test(
    quotaText(error).join("\n"),
  );
}
