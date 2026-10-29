export function paypalClientId(): string {
  return process.env.PAYPAL_SANDBOX_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || "";
}

export function paypalClientSecret(): string {
  return process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET || "";
}

export function paypalPublicClientId(): string {
  return (
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
    process.env.NEXT_PUBLIC_PAYPAL_SANDBOX_CLIENT_ID ||
    paypalClientId()
  );
}

export function hasPaypalCredentials(): boolean {
  return Boolean(paypalClientId() && paypalClientSecret());
}

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function hasGemini(): boolean {
  return Boolean(geminiApiKey());
}

export function appBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function forcePaypalMock(): boolean {
  return process.env.PAYPAL_FORCE_MOCK === "1" || !hasPaypalCredentials();
}

export function paypalWebhookId(): string {
  return process.env.PAYPAL_WEBHOOK_ID || "";
}

export function sandboxBuyerEmail(): string {
  return process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "";
}

export function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}
