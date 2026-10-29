import { jsonError } from "@/lib/http";
import { getPaypalGateway } from "@/lib/paypal";
import { handlePaypalWebhook } from "@/lib/webhook";

export const runtime = "nodejs";

const HEADER_NAMES = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
];

export async function POST(req: Request) {
  let event: unknown;
  try {
    event = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const headers: Record<string, string> = {};
  for (const name of HEADER_NAMES) headers[name] = req.headers.get(name) || "";
  try {
    const result = await handlePaypalWebhook({
      event,
      headers,
      paypal: getPaypalGateway(),
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
