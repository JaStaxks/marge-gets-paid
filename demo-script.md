# Demo video script

Target length 2:40. Hard cap 3:00. Public YouTube, no copyrighted music, no third-party logos beyond the PayPal and Venmo buttons the JS SDK renders. Phone-width for the pay page. Record the live sandbox once `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, and `GEMINI_API_KEY` are set.

## 0:00–0:15 Hook

Title card, then the owner desk.

Say: "Every no-show costs a plumber the morning. A diagnostic in San Diego is about $89, and an empty driveway is worse. Meet Marge."

On screen: Coastline Heating & Plumbing, San Diego. One line under the title: she books the job and collects the deposit before the truck rolls.

## 0:15–0:55 Customer books with Marge

Open `/` on a laptop. Type, or use the mic:

"I'm Dana Ruiz, 619-555-0199, dana@example.com, 2100 Sunset Cliffs Blvd. My water heater is leaking. Tuesday at 9am works."

Marge quotes the water heater leak diagnostic from the price book ($89) and a $49 deposit. She does not invent the numbers. An SMS-style bubble appears with `/pay/…`.

Say: "Marge is the receptionist. The price and the deposit come from the shop's price book. She texts a PayPal link, the same way a dispatcher would."

## 0:55–1:20 Pay the deposit

Open the link in a phone-width window. PayPal and Venmo buttons are on the page. Log in with the sandbox personal buyer from the README. Approve the $49 payment. Success screen: "Deposit paid."

Say: "Sandbox buyer, not a live account. Venmo shows up for a US buyer. If the webhook is slow, the capture on this page still marks the job paid."

## 1:20–1:40 Dashboard flips

Owner desk, password `coastline` unless you changed `DASHBOARD_PASSWORD`. The row moves to Deposit paid. KPI tiles update. Point at the AG Grid status chip.

Say: "The webhook is signature-checked, and a duplicate event does not double-charge the board."

## 1:40–2:10 Invoice after the visit

Select Dana's row. Technician note: "replaced anode rod, flushed tank, 1.5 hr". Click "Mark complete and invoice".

The model picks price-book codes only. The server prices them and credits the $49 deposit. Open the PayPal invoice as the sandbox buyer and pay the balance. The row goes to Paid.

Say: "The tech writes a note. The model does not get to invent the dollars. PayPal sends the invoice with the deposit already credited."

## 2:10–2:35 Under the hood

Show the README architecture diagram, or a terminal where `create_deposit_order` and `create_invoice` ran.

Say: "Orders v2 holds the deposit, with the job id in custom_id. The Agent Toolkit creates and sends the invoice, and the REST API is the fallback. Small shops lose the visit when nobody pays to hold the slot. Marge collects it while she is still on the chat."

## 2:35–2:45 Close

Repo URL and the words "Marge Gets Paid". No music bed.
