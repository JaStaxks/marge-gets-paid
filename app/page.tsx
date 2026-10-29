import { ChatPanel } from "@/components/chat-panel";
import { hasGemini } from "@/lib/env";
import { paymentsAreMock } from "@/lib/paypal";
import { SHOP } from "@/lib/shop";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="shell">
      <div className="topbar">
        <a className="brand" href="/">
          <strong>{SHOP.name}</strong>
          <span>{SHOP.city} · dispatch desk</span>
        </a>
        <a className="nav-link" href="/dashboard">
          Owner desk
        </a>
      </div>
      <section className="hero">
        <div className="intro">
          <p className="muted">Every no-show costs a one-truck shop the morning.</p>
          <h1>Meet {SHOP.receptionist}.</h1>
          <p className="lede">
            She books the visit, quotes the price book, and texts a PayPal or Venmo deposit before the truck rolls.
            After the job, a technician note becomes the invoice.
          </p>
          <div className="facts">
            <div className="fact">
              <b>Shop</b>
              {SHOP.address}
            </div>
            <div className="fact">
              <b>Hours</b>
              {SHOP.hours}
            </div>
            <div className="fact">
              <b>Deposit</b>
              $49 or 25% of the booked service, calculated in code.
            </div>
          </div>
        </div>
        <ChatPanel demoMode={!hasGemini()} paypalMock={paymentsAreMock()} />
      </section>
    </main>
  );
}
