---
sidebar_position: 3
title: POS & reservations
description: Sell in person from the console register and take date-range reservations with deposits.
---

# POS & reservations

:::info Plan availability
POS requires **Pro** or above; the register count follows your plan
(add-ons available on Business+).
:::

## The register

Open **`/{site}/pos`** in the console for a touch-first register:

- **Product grid** — tap to add; products with variants show quick chips.
- **Barcode scanners** — any keyboard-wedge scanner works: it types the
  code into the search box and presses Enter, which adds the exact
  SKU/barcode match. No drivers or pairing needed.
- **Payments** — cash (with change calculation), **card via QR** (the
  customer scans and pays on their phone; the sale completes
  automatically), or **charge to room** for checked-in reservation guests.
  Stripe Terminal readers can replace the QR step later without changing
  the flow.
- **Receipts** print through the browser's print dialog — any receipt
  printer with a system print driver works. Set the paper size to your
  roll width once and the browser remembers it.

POS sales create normal orders tagged `pos`, decrement the same inventory
as your online store (per location if you use locations), and appear in
the orders list under the channel filter.

### When something disconnects

- If the QR payment page fails to load, cancel and retake the payment —
  pending card sales never decrement stock until paid.
- Cash sales need no network round-trip beyond saving the order; if the
  console loses connection entirely, note sales on paper and enter them
  when back online (an offline queue is on the roadmap).

## Reservations

For stays (cabins, rooms, rentals):

1. Add **resources** on the Products page — nightly rate, weekend
   multiplier, minimum nights, deposit percent, and free-cancellation
   window.
2. Drop the **Reservation widget** on any screen in the besigner and point
   it at the resource id. Guests pick dates, see a live quote, and pay the
   deposit (or full amount) at checkout.
3. Manage stays from the **Reservations** card: check in, check out
   (with a folio summary if the guest charged store purchases to the
   room), walk-ins, no-shows, and cancellations.

## Related

- [Commerce overview](./overview.md)
- [Product catalog](./catalog.md)
