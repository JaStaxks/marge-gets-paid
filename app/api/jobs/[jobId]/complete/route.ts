import { cookies } from "next/headers";

import { cookieIsValid, DASHBOARD_COOKIE } from "@/lib/auth";
import { completeJob } from "@/lib/invoicing";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  const jar = await cookies();
  if (!cookieIsValid(jar.get(DASHBOARD_COOKIE)?.value)) {
    return Response.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const { jobId } = await context.params;
  let techNote = "";
  try {
    const body = (await req.json()) as { techNote?: string };
    techNote = typeof body.techNote === "string" ? body.techNote : "";
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  try {
    const job = await completeJob(jobId, techNote);
    return Response.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}
