import { createHmac, timingSafeEqual } from "node:crypto";

export const DASHBOARD_COOKIE = "marge_dashboard";

export function dashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD || "coastline";
}

export function sessionToken(): string {
  return createHmac("sha256", "marge-gets-paid-v1").update(dashboardPassword()).digest("hex");
}

export function passwordMatches(input: string): boolean {
  const given = Buffer.from(input);
  const expected = Buffer.from(dashboardPassword());
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function cookieIsValid(value: string | undefined): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(sessionToken());
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function dashboardSetCookie(maxAgeSeconds: number): string {
  const secure = process.env.VERCEL === "1" || (process.env.APP_BASE_URL || "").startsWith("https://");
  const value = maxAgeSeconds > 0 ? sessionToken() : "";
  return `${DASHBOARD_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}
