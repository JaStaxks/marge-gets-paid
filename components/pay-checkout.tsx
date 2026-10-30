"use client";

import { useEffect, useRef, useState } from "react";

import { formatUsd } from "@/lib/money";
import { SHOP } from "@/lib/shop";
import type { PayJobView } from "@/lib/types";

type Buttons = {
  render: (target: HTMLElement) => void;
  close: () => void;
};

type PaypalNamespace = {
  Buttons: (options: Record<string, unknown>) => Buttons;
};

export function PayCheckout({ job, cancelled }: { job: PayJobView; cancelled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [paid, setPaid] = useState(
    job.status === "deposit_paid" || job.status === "completed" || job.status === "invoiced" || job.status === "paid",
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const showMock = job.mockPayments || job.orderVia === "mock" || !job.paypalOrderId;

  useEffect(() => {
    if (showMock || paid) return;
    let dead = false;
    let buttons: Buttons | null = null;
    const script = document.createElement("script");
    script.src = "";
    script.async = true;

    async function load() {
      const config = await fetch("/api/paypal/config").then((response) => response.json() as Promise<{ clientId?: string }>);
      if (!config.clientId || !container.current) {
        setError("PayPal client id is missing. Set NEXT_PUBLIC_PAYPAL_CLIENT_ID and redeploy, or use the sandbox client id at runtime.");
        return;
      }
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=USD&intent=capture&enable-funding=venmo&components=buttons`;
      script.onload = () => {
        if (dead || !container.current) return;
        const paypal = (window as Window & { paypal?: PaypalNamespace }).paypal;
        if (!paypal) {
          setError("PayPal buttons did not load.");
          return;
        }
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay" },
          createOrder: () => job.paypalOrderId,
          onApprove: async (data: { orderID?: string }) => {
            await capture(data.orderID || job.paypalOrderId || "");
          },
          onCancel: () => setError("Payment cancelled. The deposit link still works if you want to try again."),
          onError: () => setError("PayPal could not open checkout. Try the button again."),
        });
        buttons.render(container.current);
        setSdkReady(true);
      };
      script.onerror = () => setError("Could not load the PayPal script.");
      document.body.appendChild(script);
    }

    void load();
    return () => {
      dead = true;
      buttons?.close();
      script.remove();
    };
  }, [showMock, paid, job.id, job.paypalOrderId]);

  async function capture(orderId: string) {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/jobs/${job.id}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error || "Capture failed.");
        return;
      }
      setPaid(true);
    } catch {
      setError("Could not reach the shop to record the payment.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="pay-wrap">
      <article className="phone">
        <header>
          <div className="who">{SHOP.name}</div>
          <p>Deposit for {job.customerName.split(" ")[0]}</p>
        </header>
        <div className="body">
          <p className="muted" style={{ margin: 0 }}>
            {job.serviceName} · {job.slotLabel}
          </p>
          <p className="amount">{formatUsd(job.depositCents)}</p>
          <p style={{ margin: 0 }}>{job.address}</p>
          {paid ? (
            <div className="success" role="status">
              <strong>Deposit paid.</strong>
              <p>Marge has the visit on the board. The balance is invoiced after the technician finishes.</p>
              <a className="pay-back" href="/">Back to Marge</a>
            </div>
          ) : (
            <>
              {cancelled ? (
                <p className="banner error-banner" role="status">
                  Checkout was cancelled. You can pay whenever you are ready. The slot stays held.
                </p>
              ) : null}
              {showMock ? (
                <>
                  <p className="banner">
                    {job.orderVia === "mock" && !job.mockPayments
                      ? "This is sample board data, not a live sandbox order. Book a new visit with Marge to charge PayPal."
                      : "PayPal keys are not configured, so this button records a simulated capture. With sandbox keys, this page shows PayPal and Venmo buttons."}
                  </p>
                  {job.orderVia === "mock" && !job.mockPayments ? null : (
                    <button className="primary" type="button" disabled={working || !job.paypalOrderId} onClick={() => capture(job.paypalOrderId || "")}>
                      {working ? "Recording…" : "Simulate sandbox payment"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: 0 }}>
                    Pay with PayPal or Venmo. Venmo shows for eligible US sandbox buyers.
                  </p>
                  <div id="paypal-buttons" ref={container} />
                  {!sdkReady && !error ? <p className="muted">Loading PayPal…</p> : null}
                </>
              )}
              {error ? (
                <p className="banner error-banner" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
          <a className="pay-back" href="/">Talk to Marge</a>
        </div>
      </article>
    </div>
  );
}
