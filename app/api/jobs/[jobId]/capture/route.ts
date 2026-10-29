import { captureJobDeposit, toPayView } from "@/lib/jobs";
import { jsonError } from "@/lib/http";
import { paymentsAreMock } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  let orderId = "";
  try {
    const body = (await req.json()) as { orderId?: string };
    if (typeof body.orderId === "string") orderId = body.orderId;
  } catch {
    orderId = "";
  }
  try {
    const job = await captureJobDeposit(jobId, orderId);
    return Response.json({ job: toPayView(job, paymentsAreMock()) });
  } catch (error) {
    return jsonError(error);
  }
}
