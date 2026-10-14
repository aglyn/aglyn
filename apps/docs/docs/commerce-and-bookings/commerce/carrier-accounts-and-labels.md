---
sidebar_position: 4.05
title: Carrier accounts and labels
description: The carrier accounts your shipping labels and checkout rates come from, connecting your own, and how label costs are paid. Rolling out.
unlisted: true
---

# Carrier accounts and labels

:::note Rolling out
Carrier accounts and shipping labels appear in your console only where the
platform you use has connected a carrier provider. Until then, none of these
cards are shown, and your shipping works exactly as your
[zones and rates](./shipping.md#zones-and-rates) say.
:::

## Carrier accounts {#carrier-accounts}

The **Carrier accounts** card lists the carriers your labels and checkout
rates come from, for every site in the workspace. By default these are
Aglyn's own accounts, marked **Discounted rates**. A switch on each row turns
that carrier on or off.

If you have your own negotiated carrier account, choose **Connect your own
account** and pick the carrier. Which carriers are listed depends on the
shipping provider behind your labels. For UPS and FedEx you enter the account
number, a contact and the account's address, and UPS then asks you to sign in
at UPS; a row that still needs it shows **Sign-in needed** or **Reconnect
needed**. Other carriers, such as DHL Express or Canada Post, ask for the
credentials that carrier issued you, which are passed to the provider to
connect the account and not kept by Aglyn. Labels bought on your own account
are billed to you by the carrier, so Aglyn charges nothing for them.

## Shipping labels {#shipping-labels}

A label bought on Aglyn's carrier accounts is charged to the workspace at the
carrier's price, with nothing added. It is taken from your Stripe balance when
the label is bought, once a member has agreed to that; when Stripe cannot take
it, the label goes on the workspace's monthly invoice instead. A voided label
that the carrier refunds is given back the same way it was paid.

**Billing → Usage** shows a **Shipping labels** card once the workspace has
bought a label: for each month, how many labels, how much came from the Stripe
balance, how much went on the invoice, and what voided labels returned.

## Related

- [Shipping](./shipping.md)
