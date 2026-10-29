import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { geminiApiKey, geminiModel, hasGemini } from "@/lib/env";

export function geminiReady(): boolean {
  return hasGemini();
}

export function geminiLanguageModel() {
  const google = createGoogleGenerativeAI({ apiKey: geminiApiKey() });
  return google(geminiModel());
}
