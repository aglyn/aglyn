---
sidebar_position: 4.5
title: Tax services (Avalara AvaTax and TaxJar)
description: Connect your own Avalara AvaTax or TaxJar account so checkout and the register charge the sales tax it calculates, and your paid orders and refunds are recorded there.
---

# Tax services: Avalara AvaTax and TaxJar

If you already calculate sales tax in an **Avalara AvaTax** or **TaxJar**
account, connect it and Aglyn asks it for the tax on every sale — at your
storefront's checkout and at the register — instead of using a flat rate,
while your store's **Taxes** are set to **Manual rates**. Under Stripe Tax it
is not used. Your
paid orders and refunds are recorded in that account, so its reports and
filings start from what you actually sold.

:::warning You remain responsible for your sales tax
Aglyn asks your tax service for a figure and records your sales there. It does
not register you anywhere, file your returns or pay the tax you collect. Where
you are registered, what you file and when are decisions for you, your tax
service and your own advisor. This is different from **Stripe Tax** mode,
where the platform collects and remits the tax for you.
:::

Tax services come with every plan that includes selling, at no extra cost.
You need your own AvaTax or TaxJar account; Aglyn does not sell one.

## Before you start

- Set your store's **Taxes** to **Manual rates** (Commerce → Settings →
  Taxes), with a rate for where you sell, and leave **Prices include tax**
  off. A tax service is used only then — see
  [When the service is not used](#when-the-service-is-not-used). Your own rates
  stay as the **fallback**: when the service does not answer, the sale is taxed
  at them instead.
- **Avalara AvaTax:** your account id (a number) and a license key, from
  AvaTax → Settings → License and API keys. If your AvaTax account has more than
  one company, the company code to file under.
- **TaxJar:** an API token, from TaxJar → Account → TaxJar API. List the states
  where you collect tax (your nexus) in TaxJar: it charges no tax anywhere else.

Both vendors offer a free **sandbox** account for testing. Connect it as a
sandbox first, place a test order, then connect your production account.

## Connect

1. Go to **Commerce → Settings** and find the **Tax service** card.
2. Choose **Avalara AvaTax** or **TaxJar**, and **Sandbox** or **Production**.
3. Enter your credentials and select **Connect**. Aglyn tests them with the
   vendor first and stores nothing they refuse. The credentials are encrypted
   on the server and are never shown again, not even to you.
4. Enter the **ship-from address**: the street, city, state and postal code
   you ship or sell from. Aglyn checks it with the service. It is the origin of
   every sale and the place an in-person sale is taxed.

Only an **admin** of the site can connect, test or disconnect a service and
change its address. **Test connection** checks the stored credentials again
whenever you like; the card shows the answer.

## When the service is not used

A connected service applies only when **Taxes** is set to **Manual rates**
with **Prices include tax** off. With any other setting it is not asked for the
tax on any sale, and new orders are not recorded in it:

- **Stripe Tax (automatic):** Stripe Tax calculates the tax instead.
- **Prices include tax:** your prices already include the tax.
- **Don't collect sales tax:** no tax is added.
- **Not chosen yet:** checkout is off until you choose.

The **Tax service** card says so while it is the case, with **Go to Taxes** to
change the setting. Your connection, product tax codes and exempt customers are
kept, and the service is used again as soon as Taxes is back on Manual rates.

## How sales are taxed

| Where | What the service is asked |
| -- | -- |
| Storefront cart and Buy now | The tax on each line, after discounts, at your ship-from address. The shopper's address is collected inside the payment page, after the tax is set, so these online sales are taxed at your address, as your own rates are. |
| Register | The tax on each line, after the cashier's discount, at your ship-from address. |

- A product you marked **tax-exempt** is sent as non-taxable and charged no tax.
- A subscription keeps your own recurring rate: a quote taken today cannot
  price next month's renewal.
- Shipping charges are not taxed at checkout, as with your own rates.
- If the service does not answer within **5 seconds**, or refuses, the sale is
  taxed at your own rates and goes through. The order says which service was
  asked and that it fell back, so you can review those sales.

## Product tax codes

Each vendor has codes for kinds of goods taxed differently from the general
rate, such as clothing or food. Set a product's **Tax code** in the product
editor, and a **Default tax code** on the Tax service card for products
without one. A product with neither is sent as general goods.

## Exempt customers

Under **Exempt customers** on the Tax service card, record a customer who does
not pay sales tax — a reseller, a nonprofit, a school, a government buyer — by
their email address, with the reason, their certificate number and, if the
exemption covers only some states, those states. A sale to that email address is
sent to the service with the exemption, and the service decides the tax.
AvaTax receives the reason and certificate number; TaxJar receives the reason.
Keep the certificates themselves: the service and your auditors may ask for them.

## Recording orders and refunds

With **Record paid orders and refunds** on (the default), each paid order is
recorded in your account under its order id, at the tax the buyer actually paid.
Recording it again — a retry — updates the same record rather than adding one.

- A **refund**, in full or in part, and a **return at the register** reverse
  their share of the sale in the service.
- A **canceled** order that was never refunded is voided.
- The order's **Tax service record** shows where it stands: **Recorded**,
  **Recording** (the service was busy; Aglyn tries again), **Not recorded**
  (with the service's reason, and **Record it again** once you have fixed it) or
  **Voided**.

## Disconnect

**Disconnect** forgets your credentials. Sales are then taxed at your own rates
again. What was already recorded stays in your account, and your product tax
codes and exempt customers are kept for when you connect again.

## What is sent to the vendor

For each quote and each recorded sale: your ship-from address, the buyer's
address (or yours for an in-person sale), the order id, each line's product,
name, quantity, amount and tax code, and any exemption you recorded. AvaTax also
receives the buyer's email address as its customer code. No payment details are
sent. The data goes to your own Avalara or TaxJar account, with your own
credentials, so the vendor acts for you and is not an Aglyn subprocessor; the
subprocessors page names both among the services a merchant connects.
