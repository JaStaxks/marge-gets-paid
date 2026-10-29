import { geminiModel, hasGemini, paypalPublicClientId } from "@/lib/env";
import { paymentsAreMock } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    clientId: paymentsAreMock() ? "" : paypalPublicClientId(),
    mock: paymentsAreMock(),
    ai: hasGemini(),
    model: hasGemini() ? geminiModel() : null,
  });
}
