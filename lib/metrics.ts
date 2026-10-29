import type { Job, JobStatus } from "@/lib/types";

const DEPOSIT_COLLECTED: JobStatus[] = ["deposit_paid", "completed", "invoiced", "paid"];

export type Kpis = {
  booked: number;
  depositsCollectedCents: number;
  outstandingCents: number;
  paidCents: number;
};

export function kpis(jobs: Job[]): Kpis {
  const active = jobs.filter((job) => job.status !== "cancelled");
  let depositsCollectedCents = 0;
  let outstandingCents = 0;
  let paidCents = 0;
  for (const job of active) {
    if (DEPOSIT_COLLECTED.includes(job.status)) depositsCollectedCents += job.depositCents;
    if (job.status === "paid") {
      paidCents += job.depositCents + (job.invoiceTotalCents ?? 0);
      continue;
    }
    if (job.status === "invoiced") {
      outstandingCents += job.invoiceTotalCents ?? 0;
      continue;
    }
    if (job.status === "deposit_paid" || job.status === "completed") {
      outstandingCents += Math.max(0, job.quoteCents - job.depositCents);
      continue;
    }
    if (job.status === "booked" || job.status === "deposit_pending" || job.status === "new") {
      outstandingCents += job.quoteCents;
    }
  }
  return {
    booked: active.length,
    depositsCollectedCents,
    outstandingCents,
    paidCents,
  };
}

export function statusLabel(status: JobStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "booked":
      return "Booked";
    case "deposit_pending":
      return "Deposit due";
    case "deposit_paid":
      return "Deposit paid";
    case "completed":
      return "Completed";
    case "invoiced":
      return "Invoiced";
    case "paid":
      return "Paid";
    case "cancelled":
      return "Cancelled";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}
