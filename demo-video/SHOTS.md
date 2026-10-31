# Shots

The master is 2:26, 1920×1080, 60 fps. Live pictures are Playwright recordings of https://marge-gets-paid.vercel.app. The owner desk is this same app on localhost with `PAYPAL_FORCE_MOCK=1` and a password set only for the recording.

## Captured

- Live chat. Test Customer, 555-010-2030, test@example.com, 12 Demo St. Water heater leaking. Tuesday at 9:00 AM.
- Marge’s quote card: Water heater leak diagnostic, $89.00, deposit $49.00. She offers Tuesday, November 3, 9:00 AM.
- The in-app text bubble and the Pay $49.00 deposit control.
- `/pay/job_bf87a3bf` with the real PayPal JS SDK: PayPal, Venmo, Pay Later, and Debit or Credit Card. Nothing was clicked.
- Local owner desk: login, sample AG Grid, Helen Cho’s technician note, and the mock invoice (lines, $49 deposit credit, balance $205.00, `INV2-MOCK-96749B`, “sent via mock”).

## Not captured

- No PayPal or Venmo payment. The README has no sandbox buyer password, and the brief says not to complete one.
- No production owner desk. The production password is not in this recording. The repo default `coastline` was not used against production.
- No live webhook, and no signature-check event on the production job. The pay page was not captured, so nothing moved that row to Deposit paid.
- No real PayPal invoice and no Agent Toolkit call in the recording. The local complete path used the mock gateway. The rail names Orders v2, Invoicing, the Agent Toolkit, and webhooks as the app is built in this repo.
- Gemini returned a one-line error, “Marge lost the model for a moment,” on the first turn. The quote card still rendered. Marge asked to confirm, and a second message booked the slot. The cut shows the quote and the deposit text. It does not feature the error banner. The second message (“Please book it…”) is visible because that is what confirmed the booking.

## Left on the live site

Reset needs the owner desk, which this recording cannot open. This job is still there:

| | |
| --- | --- |
| Job | `job_bf87a3bf` |
| Customer | Test Customer |
| Phone | 555-010-2030 |
| Email | test@example.com |
| Address | 12 Demo St |
| Service | Water heater leak diagnostic |
| Slot | Tue, Nov 3, 2026, 9:00 AM Pacific |
| Quote / deposit | $89 / $49 |
| Pay page | https://marge-gets-paid.vercel.app/pay/job_bf87a3bf |
| Payment | Not completed |

Local mock invoices from the desk takes stayed in `data/store.json` on the recording machine. They are not on the live site.
