import { cookies } from "next/headers";

import { DashboardLoader } from "@/components/dashboard-loader";
import { LoginForm } from "@/components/login-form";
import { cookieIsValid, DASHBOARD_COOKIE } from "@/lib/auth";
import { usesRedis } from "@/lib/env";
import { kpis } from "@/lib/metrics";
import { readStore } from "@/lib/store";
import { AppError } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const jar = await cookies();
  if (!cookieIsValid(jar.get(DASHBOARD_COOKIE)?.value)) return <LoginForm />;
  try {
    const data = await readStore();
    return <DashboardLoader initialJobs={data.jobs} initialKpis={kpis(data.jobs)} store={usesRedis() ? "redis" : "file"} />;
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The board could not be loaded.";
    return (
      <main className="gate">
        <h1>The board is offline.</h1>
        <p>{message}</p>
      </main>
    );
  }
}
