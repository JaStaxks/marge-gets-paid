import { dashboardSetCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": dashboardSetCookie(0),
    },
  });
}
