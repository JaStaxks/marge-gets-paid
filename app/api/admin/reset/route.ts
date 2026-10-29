import { cookies } from "next/headers";

import { cookieIsValid, DASHBOARD_COOKIE } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { kpis } from "@/lib/metrics";
import { resetStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  if (!cookieIsValid(jar.get(DASHBOARD_COOKIE)?.value)) {
    return Response.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const data = await resetStore();
    return Response.json({ jobs: data.jobs, kpis: kpis(data.jobs), seededAt: data.seededAt });
  } catch (error) {
    return jsonError(error);
  }
}
