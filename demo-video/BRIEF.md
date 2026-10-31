# Brief — Marge Gets Paid demo film

Business: Coastline Heating & Plumbing, San Diego. One-truck HVAC and plumbing shop. The product is Marge, an AI receptionist in this repository.

Buyer of the film: PayPal AI Hackathon judges, then a public YouTube upload.

Viewer problem: a missed call or a no-show costs the shop the morning. The shop's own price book lists a water-heater leak diagnostic at $89 and a $49 deposit to hold the truck.

Single action: open the live desk and talk to Marge. https://marge-gets-paid.vercel.app

What is provably true:

- The live deployment runs this app with Gemini and the PayPal sandbox (the homepage pill says so).
- Prices come from `lib/price-book.ts`. Water heater leak diagnostic is $89. Deposit is $49. The model cannot pass a price.
- Deposit orders are Orders v2 with `custom_id` set to the job id. The pay page loads the PayPal JS SDK with `enable-funding=venmo`.
- Invoices go through `@paypal/agent-toolkit` (`create_invoice`, `send_invoice`), with the Invoicing REST API as fallback.
- Webhooks hit `POST /api/paypal/webhook`, which calls PayPal signature verification. Stored event ids make a duplicate a no-op.
- The owner desk uses AG Grid Community.

What must never be claimed:

- That a payment was completed in this film. It is not.
- That the local owner desk is the production board. It is the same app, local, sample jobs, mock gateway, password set only for this recording.
- That sample customers (Luis, Helen, Marcus, Priya) are real people who paid.
- Any rating, testimonial, warranty, savings figure, or completed-job count that is not in the repo.
- Third-party logos other than the PayPal and Venmo buttons the JS SDK renders.
- AI imagery presented as a real customer, truck, or house.

Length: 2:15–2:45. Hard cap 3:00. 1920×1080, 60fps master.

Brand: sand `#f3ecdf`, paper `#fffaf3`, navy `#123244`, sea `#1f6f62`, coral `#c85a3e`, ink `#1c1712`. Display: Fraunces. Sans: Outfit. Bright, not moody.

Real assets: Playwright recordings of the live site and of the local owner desk. No mockups of the product UI.

Mechanisms borrowed (not layouts): foreground fly-through (Contra / Wonder / Bolt), wall of missed calls collapsing to one job (Contra), persistent rail across the API steps (Replit), materializing result for the quote (Replit Slides), request then confirmation (Poke).
