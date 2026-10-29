import type { ModelMessage, UIMessage } from "ai";

import type { TranscriptEntry } from "@/lib/types";

function textFromParts(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function transcriptFromUi(messages: UIMessage[]): TranscriptEntry[] {
  const now = new Date().toISOString();
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textFromParts(message.parts as Array<{ type: string; text?: string }>);
    if (!text) continue;
    entries.push({ role: message.role, text, at: now });
  }
  return entries.slice(-40);
}

export function transcriptFromModel(messages: ModelMessage[]): TranscriptEntry[] {
  const now = new Date().toISOString();
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("\n");
    }
    text = text.trim();
    if (!text) continue;
    entries.push({ role: message.role, text, at: now });
  }
  return entries.slice(-40);
}

export function userText(messages: UIMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => textFromParts(message.parts as Array<{ type: string; text?: string }>))
    .join("\n");
}
