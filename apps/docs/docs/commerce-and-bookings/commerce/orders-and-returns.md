---
sidebar_position: 3
title: Fulfillment, returns and webhooks
description: Ship an order in parts with tracking links, run returns from request to refund, print and send invoices, and send order events to your own systems.
---

# Fulfillment, returns and webhooks

What happens to an order after it is paid: shipping it, in one parcel or several;
taking items back; printing its paperwork; and telling your other systems about it.
Everything here is in the order's dialog on the **Orders** tab of the **Products**
hub, under **Returns** beside it, and on its **Checkout** and **Notifications**
settings pages.

## Ship an order in parts {#fulfillment}

**Fulfill…** in the order's dialog opens the **Fulfill items** panel. Each line starts
at the units still to ship; lower a quantity to send part of a line now and the rest
later. Digital and service lines have nothing to ship and never hold an order open.

- **Carrier** and **Tracking number** make the tracking link for USPS, UPS, FedEx, DHL,
  Canada Post, Royal Mail and Australia Post. For any other carrier, choose **Other**,
  type its name, and paste the **Tracking link** yourself.
- **Shipping cost** is optional: what sending this shipment cost you, in your store's
  currency. Enter `0` for free shipping; leave it empty when you don't know. Each
  shipment keeps its own cost, so a partial shipment and the rest can differ. It is
  asked only for a shipment you enter by hand; a label you buy in Aglyn keeps what the
  label cost. A Faire order sends it to Faire as the shipping you paid
  ([Marketplaces](marketplaces.md)).
- **Notify customer** emails the buyer the shipment with its tracking link. Leave it
  off to record a shipment quietly.
- The order reads **Partially fulfilled** until every unit that ships is out, then
  **Fulfilled**.

Each shipment is listed in the dialog. **Edit tracking** corrects a carrier or a
number; **Cancel shipment** puts its units back to be shipped again. Ticking orders
in the list and choosing **Mark as fulfilled** ships every remaining unit of each.

## Invoices and packing slips {#invoices}

**Invoice** in the order's dialog has three choices:

- **Print invoice** opens the order as a bill, ready to print: your business name,
  the date, who it is billed and shipped to, each line with its unit price, the
  subtotal, discount, shipping, tax and total, and anything refunded. Your store's
  receipt footer and terms address print at the foot.
- **Download PDF** saves the same invoice as a PDF file in your site's look: your
  logo and contact details at the top, a band in your site's primary color, the
  invoice number, the order date and whether it is paid, then the lines and totals.
  A paid quote's invoice works the same way, with **Included** beside anything
  included at no charge.
- **Send invoice** emails the invoice to your customer, with the PDF attached. See
  [Send an invoice](#send-invoice).

The PDF takes your logo and contact details from your site's settings, and its
colors from your site's theme. Downloading it takes the **Manage orders**
permission.

### Send an invoice {#send-invoice}

**Send invoice** opens a short form: **To** (your customer's email, filled in from
the order), **Subject** and **Message**. Your message is shown at the top of the
email, in your words. The email goes out in your site's look, from your site, with
the invoice attached as a PDF. Replies go to your site's contact email, or to you
when the site has none.

What the email says depends on whether the order is paid:

- **Unpaid**: "Invoice #1042 from" your business, the invoice number, its date, the
  total and what is due, and a **Pay** button. The button opens the invoice on your
  own site, where your customer pays it by card. The same link is printed on the PDF.
- **Paid**: the same invoice, marked paid on the day it was paid, for your
  customer's records. It has no button.

Once it's sent, the order's dialog says when and to whom: "Invoice sent Oct 29,
2026, 3:04 PM to jordan@example.com." Each invoice you send is also on the order's
timeline. Sending it again sends it as a reply to the one before, so your customer
sees one conversation. Keep the subject the same to keep it that way.

### The invoice's pay link {#invoice-pay-link}

An unpaid invoice's **Pay** button opens a page on your site at `/pay-quote`, the
same page a [quote's pay link](quotes-and-proofs.md#pay-link) opens. For an order
it says **Invoice #1042**: the items, the totals, who it's billed and shipped to,
**Download PDF**, and **Pay**.

The link doesn't expire. Each press of **Pay** opens a fresh payment, priced from
the order as you saved it, so it works on any day until the order is paid. A draft
order's first payment link, the Stripe page you copy when you make the draft, lapses
after a day; send the invoice and your customer can pay whenever they're ready. When
they press **Pay**, the draft's first payment link stops working, so the order can
only be paid once.

A draft order's invoice charges what the draft was priced at: its items, its
discount and its tax. If the draft ships, your customer chooses from the same
shipping rates the draft offered, and Stripe asks for the address. If your store
uses Stripe Tax, the tax is worked out when they pay.

When your customer pays:

- the order is marked **Paid** and joins your orders on the day you made it;
- your customer gets a receipt, and the invoice page shows **Paid** with a link to
  their order;
- you're notified, and stock goes down for your catalog products.

A second payment, after the order was already paid, isn't counted as a sale. It's
recorded on the order's timeline and you're notified, so you can refund it in
Stripe.

The order's status page on your site also shows **Pay** while the order is unpaid.

### Which orders an invoice can be sent for {#invoice-which-orders}

You can send an invoice for any paid order, and for an unpaid
[draft order](overview.md#orders) or [quote](quotes-and-proofs.md#invoice). The
form says why it can't be sent when:

- the order was canceled or refunded;
- the order has no items and no total;
- the order isn't paid and can't be paid online from an invoice, such as a sale
  still open at the register. Take its payment there, then send the invoice;
- a draft order was made before invoices could charge its shipping. Make a new
  draft order and send its invoice;
- your store hasn't finished its sales tax settings, or the invoice is for less
  than $0.50;
- the address bounced or reported an email as spam. An invoice still goes to an
  address that unsubscribed from your site's newsletter, as a receipt does.

Sending an invoice takes the **Send quotes and invoices to customers** permission.
See [Order permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#order-permissions).

**Packing slip** prints what goes in the box — the shipping address and each line's
quantity, name, option and SKU — with no prices.

## Returns {#returns}

A return is its own record beside the order: what is coming back and why, what you
decided, the return label, what went back in stock, and the refund. Every return is
listed under **Returns** in the Products hub, newest first; the **Status** filter shows
one state at a time.

### How a buyer asks {#buyer-requests}

A buyer asks for a return themselves, from either of two places:

- the **Request a return** link beside an order in their account on your store, when
  they are signed in;
- the **Request a return** button on the order's status page — the **View your
  order** link in every order email — which needs no account. The button shows only
  while the return window is open and something on the order can still come back.

Both open the return page at `/order-return` in your site's header and footer. The
page is unlisted, so search engines leave it out; to design your own, make a page at
`/order-return` and place the **Return request** block on it. The buyer chooses how many of each item to send back and a reason for each — **Arrived
damaged**, **Wrong item**, **Not as described**, **Size or fit**, **No longer needed**
or **Other** — and can add a note. Only items that have shipped can be returned, and
never more than were bought or are already coming back. The workspace owner is sent
the **Return requested** email, and the site's admins and editors get a **New order**
notification in the console, each as their own notification settings say. See
[Who on your side is told](order-notifications.md#who-is-told).

Under **Checkout** → **Returns**:

- **Accept return requests online** — turn it off to take returns only by contact.
  You can still start a return for a buyer from the order.
- **Return window in days** — counted from the last shipment, or from the order date
  for an order with nothing to ship. `0` to 365.
- **Returnable product types** — physical products only, by default.

### Run a return {#run-a-return}

Open a return from the list, or from the **Returns** section of its order's dialog,
where **Start return** opens one for the buyer. A return you start is approved at once.

| Status | What you can do |
| --- | --- |
| **Requested** | **Approve** or **Decline**, each with an optional **Note to the customer** and **Notify customer**. The buyer is emailed your answer. |
| **Approved** | **Mark received…** when the parcel arrives, or **Refund…** without waiting for it. |
| **Received** | **Refund…**. |
| **Refunded**, **Declined** | **Close return** when you are done with it. |

**Mark received…** asks how many of each line to put back in stock — all of them, by
default — and, when your store has more than one location, where. Each unit restocked
is written to [Stock movements](overview.md#stock-movements) beside the sale.

**Refund…** suggests what the items are worth — each line's paid price, after the
order's discount, for the units coming back — and you can change it, for example to
add the shipping. The money goes back to the original payment through the order's own
refund, so the refund rules are the same: it needs the **Refund orders** permission,
and it cannot refund more than is left on the order. Asking twice refunds once. The
buyer is emailed the amount, and the order's restock question is answered by what the
return already put back.

The four return emails — **Return requested**, **Return approved**, **Return
declined** and **Return refunded** — are designed like your other store emails.


## Order webhooks {#order-webhooks}

An order webhook posts each order event to an address you choose, as it happens: a
warehouse system, an ERP, a spreadsheet script. Add them under **Notifications** →
**Order webhooks** in the Products hub. Managing webhooks needs the **Manage order
webhooks** permission. By default, as with refunds, that's an admin of the whole
workspace who is also the site's admin.

**Add endpoint** asks for:

- **Endpoint URL** — an `https://` address on a public server. Redirects are not
  followed, so give the final address.
- **Events** — any of the events below.

When you add an endpoint, its **signing secret** is shown once. Copy it into your
endpoint's settings; **Roll secret** makes a new one if it is lost. A store can keep
10 endpoints. **Pause** stops deliveries to one without deleting it, and **Send test
event** posts a `webhook.test` event now.

| Event | When |
| --- | --- |
| `order.paid` | An order was paid: online, buy-now, a payment link, a POS sale or a subscription renewal. |
| `order.fulfilled` | A shipment was recorded, once per shipment. |
| `order.delivered` | The order was marked delivered. |
| `order.refunded` | Money went back to the buyer, once per refund, including a refund made in the Stripe Dashboard. |
| `order.cancelled` | The order was canceled. |
| `return.requested` | A buyer asked for a return, or you opened one. |
| `return.approved` | You approved a return, or opened one yourself. |
| `return.declined` | You declined a return request. |
| `return.received` | The returned items arrived. |
| `return.refunded` | A return was refunded. |

### When an endpoint is down

An endpoint has 8 seconds to answer each event. One that doesn't is sent the event
again, on a schedule that lasts about a day, and the site's admins and editors are
notified in the console if the last try fails.

Whoever builds your endpoint needs [Order webhooks for developers](../../developers/order-webhooks.md):
what each event carries and how to check that it came from your store.

**Deliveries** on an endpoint lists what was sent in the last 30 days, newest first,
with each attempt's status. Filter it by **Delivered**, **Retrying** or **Failed**, open
a delivery's **Body**, and **Resend** one once your endpoint is fixed.

## Related

- [Commerce overview](overview.md#orders)
- [Commerce end to end](../../guides/commerce-end-to-end.md)
