import { cookies } from "next/headers";

import { cookieIsValid, DASHBOARD_COOKIE } from "@/lib/auth";
import { redisConfig } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { kpis } from "@/lib/metrics";
import { readStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  if (!cookieIsValid(jar.get(DASHBOARD_COOKIE)?.value)) {
    return Response.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const data = await readStore();
    return Response.json({
      jobs: data.jobs,
      kpis: kpis(data.jobs),
      store: redisConfig() ? "redis" : "file",
      seededAt: data.seededAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
