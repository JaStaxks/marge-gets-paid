import { dashboardSetCookie, passwordMatches } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!passwordMatches(password)) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": dashboardSetCookie(60 * 60 * 24 * 7),
    },
  });
}
