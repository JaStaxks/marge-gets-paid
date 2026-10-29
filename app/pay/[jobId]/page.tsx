import Link from "next/link";

import { PayCheckout } from "@/components/pay-checkout";
import { getJob, toPayView } from "@/lib/jobs";
import { paymentsAreMock } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { jobId } = await params;
  const query = await searchParams;
  const job = await getJob(jobId);
  if (!job) {
    return (
      <main className="gate">
        <h1>That pay link is not on the board.</h1>
        <p>Ask Marge for a new deposit text, or reset the demo from the owner desk.</p>
        <Link href="/">Back to Marge</Link>
      </main>
    );
  }
  return <PayCheckout job={toPayView(job, paymentsAreMock())} cancelled={query.cancelled === "1"} />;
}
