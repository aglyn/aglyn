---
sidebar_position: 4.05
title: Shipping labels and live carrier rates
description: Buy carrier labels from your orders, one at a time or in a batch, quote live carrier rates at checkout, connect your own carrier accounts, and let carrier tracking move orders along and email customers. Rolling out.
---

# Shipping labels and live carrier rates

:::note Rolling out
Shipping labels, carrier accounts and live carrier rates appear in your console
only once they are available on the platform you use. Until then, none of the
cards, buttons and fields on this page are shown, there is no **Carrier rates**
rate type, and your shipping works exactly as your
[zones and rates](./shipping.md#zones-and-rates) say.
:::

Buy postage for an order from the order itself, print the label, and the order
is marked shipped with its tracking number. Checkout can also quote each
carrier's live price for the shopper's address, and carrier updates move your
orders to delivered.

This page covers labels, carrier accounts, live rates and tracking. Zones and
rates, and the address each location ships from, are covered in
[Shipping](./shipping.md). To buy labels on your own Easyship or Sendcloud
account, or price checkout with ShipperHQ, see
[Ship with your own Easyship, Sendcloud or ShipperHQ](./ship-with-your-own-easyship-sendcloud-or-shipperhq.md).

## Before you start {#before-you-start}

- **A store that ships.** The site sells products, and shipping is on for it.
- **A way to pay for labels.** Labels on the platform's carrier accounts are
  paid from your store's Stripe balance, which needs your Stripe account
  connected, or on your workspace's monthly invoice, which needs a payment
  method on the **Billing** page. Labels on a carrier account of your own are
  billed to you by that carrier. See [Paying for labels](#paying-for-labels).
- **Who can do what:**

  | Task | Who |
  | --- | --- |
  | See the **Shipping labels** card, get rates, buy, print and void labels, buy batch and return labels, check addresses | An **editor** or **admin** of the site |
  | Save the **Shipping labels** card, see **Paying for labels** and the **Carrier accounts** card | An **admin** of the site |
  | Turn Stripe balance payments on or off, switch a carrier on or off, connect a carrier account | An **admin** of the site who also has the workspace's **Manage billing** permission |
  | See the **Shipping labels** card on **Billing → Usage** | A workspace member with **View billing** |

## Set up labels {#shipping-labels-settings}

1. Open your site's **Products** hub and choose **Shipping & delivery**. Find
   the **Shipping labels** card.
2. Fill in each section below.
3. Select **Save** in the card's header.

The card's subheading names the carrier platform your labels are bought
through. When that platform is in test mode, the card says **Test mode: labels
and rates are samples, and nothing is charged.**

### Ship from {#ship-from}

Under **Location**, pick one of your store locations, or **An address of its
own** and type the address. A location appears in the list once it has a
postal address (see [Where parcels ship from](./shipping.md#where-parcels-ship-from)).

Labels and carrier rates need a complete address to ship from: street, city,
postal code and country. Until there is one, the card shows a warning.

### Boxes {#boxes}

List the boxes you ship in: a **Name**, **Length (cm)**, **Width (cm)**,
**Height (cm)** and **Empty weight (g)** for each. Tick **Default** on the box a
label starts with. **Add a box** adds another, up to 20. You can't remove the
last box.

The empty weight is added to the weight of the goods. Checkout also rates a
parcel in the default box when the products in it have no packed size.

### Labels {#label-options}

- **Label format**: **PDF, 4 × 6 in (thermal)**, **PDF, letter paper**, or
  **ZPL, 4 × 6 in (Zebra printers)**.
- **Signature**: **No signature**, **Signature required** or **Adult signature
  required**. It applies to labels and to checkout quotes.
- **Insure each label for the value of what it carries.**
- **Customs declarations signed by**: the name printed on customs forms for
  parcels that cross a border.

### Services offered at checkout {#checkout-services}

Tick the carrier services checkout may offer. Leave all unticked to offer
every service the carrier quotes. Each shipping rate set to **Carrier rates**
can narrow this further. This list only limits checkout: you can still buy a
label for any quoted service from the order.

### Paying for labels {#paying-for-labels}

Admins see how labels are charged here. To have each label's cost taken from
your store's Stripe balance, tick the box that starts **I authorize Aglyn to
take the cost of each shipping label I buy from my store’s Stripe balance**.
Only a member who manages billing can change it.

Each label on the platform's carrier accounts is paid by the first of these
that applies:

- **From your Stripe balance**, when the box is ticked and your store's Stripe
  account is connected. A voided label that the carrier refunds is returned
  there.
- **On your monthly invoice** otherwise, or when your balance can't cover a
  label. The label shows **The label’s cost will be on your next invoice**,
  with the reason.

If neither is possible, buying a label is refused before anything is charged.
Labels on a carrier account of your own, and test labels, cost nothing here.

## Carrier accounts {#carrier-accounts}

The **Carrier accounts** card, on **Products → Shipping & delivery**, lists the
carriers your labels and checkout rates come from, for every site in the
workspace. By default these are the platform's carrier accounts, marked
**Discounted rates**. A carrier account you connected is marked **Your
account**. Where a row has a switch, it turns that carrier on or off.

If you have your own negotiated carrier account:

1. Select **Connect your own account** in the card's header.
2. Pick the **Carrier**. Which carriers are listed depends on the carrier
   platform behind your labels.
3. Fill in what the carrier asks for:
   - **UPS** and **FedEx**: the **Account number**, the **Account holder**,
     **Company**, **Email** and **Phone**, and the **Billing address on the
     account**.
   - Other carriers, such as DHL Express or Canada Post, ask for the
     credentials that carrier issued you. They are sent to the carrier
     platform to connect the account and are not kept by Aglyn.
4. Select **Connect**. UPS then asks you to sign in at ups.com to finish. A row
   that still needs it shows **Sign-in needed** or **Reconnect needed**.

Labels bought on your own carrier account are billed to you by the carrier, so
Aglyn charges nothing for them. When you get rates for a label, a rate on your
own account is marked **Your account**.

## Product package details {#product-shipping-fields}

Physical products have a **Shipping** section in the product editor:

- **Packed length (cm)**, **Packed width (cm)** and **Packed height (cm)**: the
  product's size as packed. A product with no packed size is rated in your
  default box.
- **HS tariff code**: for customs, on parcels that cross a border.
- **Country of origin**: where it was made, as two letters, such as `US`.

Select **Save product** to keep them. Weight is not here: it stays on each
variant, where the editor already keeps it, and a label's weight is summed from
it.

## Carrier rates at checkout {#carrier-rates-at-checkout}

1. Open **Products → Shipping & delivery** and, on the **Shipping** card, add a
   rate to a zone with the **Type** **Carrier rates**.
2. Turn on the services this rate offers, or leave every one off to offer all
   of them.
3. Optionally set **Markup (%)** and **Handling fee ($)**. Both are added to
   each carrier's quote.
4. Under **If no live rate**, pick another rate of the same zone. Checkout
   offers it whenever a live quote isn't available.
5. Select **Save shipping settings**.

Shoppers then see each carrier's service and price for their address, with
the delivery estimate in business days when the carrier gives one. Checkout
asks for the postal code before it quotes, and the postal code field in the
cart and on the product page notes that carrier rates depend on it. While live
quotes are offered, the fallback rate is hidden.

Checkout falls back when no carrier answers within a few seconds, and until
labels are ready for your workspace: an address to ship from, and your
workspace set up with the carrier platform, which happens the first time
someone gets label rates or an admin opens the **Carrier accounts** card. If
live rates aren't available on your site, a **Carrier rates** rate says so and
checkout offers the fallback rate.

## Address checks {#address-checks}

When an order is paid, its shipping address is checked with the carrier.
If the carrier can't deliver to it, the order shows **The carrier cannot
deliver to this order’s address.** above its labels, with the carrier's
reason. If the carrier suggests a correction, it shows **The carrier suggests a
corrected address for this order. Review it under Buy label.** Contact your
customer before you buy a label.

To check again, use **Check address** in the label dialog (see below).

## Buy a label {#buy-a-label}

1. Open the order and find **Shipping labels**. Select **Buy label**. It is
   available while something on the order is still to ship and the order has a
   shipping address.
2. Select **Check address** to ask the carrier about the address. If it
   suggests a correction, **Use this** buys the label for the corrected
   address. The order's own address stays as your customer gave it.
3. Under **Units in this parcel**, set how many of each item go in this box.
   Everything not yet shipped is filled in. Lower the numbers to split the order
   across boxes.
4. Pick the **Box**, or **Another size** and enter its length, width and
   height. **Weight (g)** is summed from the products and the box: change it to
   your scale's reading.
5. Select **Get rates**. Pick a rate. **Cheapest**, **Fastest** and **Best
   value** are marked, and **Your account** marks a rate on a carrier account
   of your own.
6. Select **Buy label**.

The label opens in a new tab to print. The order records a shipment for those
units with the carrier and tracking number, moves to **Fulfilled** or
**Partially fulfilled**, and your customer gets the shipped email.

Each label on the order shows its status, service, tracking number, tracking
status and cost, with:

- **Print** to open it again;
- **Customs invoice** for a parcel that crosses a border;
- **Void** to cancel a label you won't use.

### Void a label {#void-a-label}

Select **Void** on the label. The label shows **Refund pending** until the
carrier answers, then **Voided**, or **Void refused** when the carrier won't
refund it (for example, outside its void window). When the carrier refunds a
voided label, its charge is given back the way it was paid.

## Batch labels {#batch-labels}

1. In the orders list, tick the orders to ship, up to 50, and select **Buy
   labels (n)**.
2. Pick the **Box** and the **Service**: **Cheapest for each order** or
   **Fastest for each order**.
3. Select **Get rates**. Review the service, weight and price for each order.
   An order that can't be rated shows why in place of its service.
4. Select **Buy labels**.

Each order is handled as if you had bought its label on its own: it records a
shipment and your customer gets the shipped email. When they are bought:

- **All labels** opens one page linking every label;
- **Packing slips** prints one slip per parcel, with the address and what goes
  in the box;
- **Print** on each row opens that order's label.

If a batch is interrupted and you buy again, labels already bought aren't
bought twice. If a label can't be paid for, the batch stops at that order.

## Return labels {#return-labels}

There are two ways to buy a label from your customer back to your ship-from
address.

**From a return.** Open the return under **Products → Returns**. While the
return is requested or approved and has no label yet, select **Buy return
label**. Choose the **Units coming back**, the box and a rate, then **Buy
label**. The label is attached to the return. Your customer sees **Print your
return label** on the page where they asked for the return, and later emails
about the return include the label link.

**From the order.** Once something has shipped, the order's **Shipping
labels** has **Return label**. It buys a return label for the shipped units
and lists it on the order marked **Return**. Print it and send it to your
customer yourself.

A return parcel's tracking is kept on its label, but it doesn't change the
order's status.

## Tracking {#tracking}

Every label you buy is followed. So is a shipment you record by hand with a
carrier and tracking number, for USPS, UPS, FedEx, DHL Express, Canada Post,
Royal Mail and Australia Post.

Each carrier update is added to the order's timeline, and the label shows the
latest status: **Label created**, **In transit**, **Out for delivery**,
**Delivered**, **Delivery problem** or **Returned to sender**. Updates that
arrive late or out of order never move a parcel backward.

When every parcel of a fully shipped order is delivered, the order moves to
**Delivered** and your customer gets the delivered email.

## Label spend {#label-spend}

Once your workspace has bought a label, **Billing → Usage** shows a **Shipping
labels** card for this month and the five before it: **Labels**, **From
Stripe balance**, **On invoice**, and **Voided, returned**.

## Troubleshooting {#troubleshooting}

| The console says | What to do |
| --- | --- |
| Labels and carrier rates need a complete address to ship from | Under **Ship from**, pick a location with a full address, or type one: street, city, postal code and country. |
| Add the address you ship from in Shipping settings first. | The same: set **Ship from** on the **Shipping labels** card and select **Save**. |
| This order has no complete shipping address. | Add the street, city, postal code and country to the order's shipping address. |
| Orders that are *status* can’t be shipped. | Only paid and partially fulfilled orders can be shipped. |
| Everything on this order has shipped. | There is nothing left to ship. Use **Return label** for a return. |
| Everything left on this order is being shipped by *service* / Some of these items are now being shipped by *service*. Get rates again. | Another fulfillment service holds those items. Ship them there, or get rates again for the rest. |
| Nothing on this order has shipped yet. | A return label needs units that have shipped. |
| Those rates have expired. Get rates again. | Select **Get rates again**, pick a rate and buy. |
| No carrier quoted this parcel. | Check the box size, weight and address, then get rates again. |
| No rate matches the service rule. (in a batch) | No carrier quoted that order. Buy its label from the order instead. |
| This label is already being bought. | Wait a moment, then reopen the order. The label appears once it is bought. |
| Labels can’t be paid for yet. | Tick the Stripe balance box under [Paying for labels](#paying-for-labels), or add a payment method on the **Billing** page. |
| The label’s cost will be on your next invoice: *reason* | The label is bought. Stripe couldn't take its cost from your balance, so it goes on your monthly invoice. |
| The label was bought but the order was not updated: *reason*. | The label is valid. Record the shipment on the order by hand with its tracking number. |
| Only a bought label can be voided. | The label failed or is already voided. |
| Only a workspace member who manages billing can change this | Ask a member with **Manage billing** to change it. |
| Not permitted | Your role on the site doesn't allow this. See [Before you start](#before-you-start). |
| Verify your email address first | Verify your email address, then try again. |
| Pick between 1 and 50 orders. | Tick at most 50 orders for one batch. |
| Something went wrong. Try again. | Try again. If it keeps happening, contact support. |

When the carrier itself refuses (an address it can't read, a parcel too heavy
for the service), the console shows the carrier's own words.

## Related

- [Shipping](./shipping.md): zones, rates and where each location ships from
- [Ship with your own Easyship, Sendcloud or ShipperHQ](./ship-with-your-own-easyship-sendcloud-or-shipperhq.md)
- [Fulfillment, returns and webhooks](./orders-and-returns.md)
