"use client";

import dynamic from "next/dynamic";

import type { Kpis } from "@/lib/metrics";
import type { Job } from "@/lib/types";

const DashboardApp = dynamic(() => import("@/components/dashboard-app").then((mod) => mod.DashboardApp), {
  ssr: false,
  loading: () => <p className="loading">Opening the board…</p>,
});

export function DashboardLoader(props: { initialJobs: Job[]; initialKpis: Kpis; store: "redis" | "file" }) {
  return <DashboardApp {...props} />;
}
