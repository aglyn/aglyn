---
sidebar_position: 3.5
title: POS hardware
description: Card readers (and buying them, rolling out), a customer display tablet, driverless receipt and kitchen printers, a cash drawer that opens on cash sales, barcode scanning, and product and shipping labels.
---

# POS hardware

The register runs in a browser, so it works on an iPad, an Android tablet, a
laptop or a desktop at the counter. This page covers the hardware around it:
a card reader, a customer display, a receipt printer, a kitchen printer, the
cash drawer, barcode scanners and a label printer.

:::info Plan availability
POS hardware comes with POS, on **Pro** and above. There is no extra charge for
printers, scanners or customer displays.
:::

## Recommended kit

| Device | Recommended | Why |
| --- | --- | --- |
| Register | iPad (10th gen or newer) or an Android tablet on a stand | Touch-first, and the camera scans barcodes |
| Receipt printer | **Star mC-Print3** or **Star TSP143IV** (CloudPRNT), or **Epson TM-m30III** (Server Direct Print) | Prints from any device over the internet: no driver, no pairing, no app |
| Cash drawer | Any 24 V drawer with an RJ12 cable, such as the Star CD3-1616 or the APG Vasario | Plugs into the printer's drawer port and opens when the printer tells it to |
| Barcode scanner | Any USB or Bluetooth scanner in keyboard mode, or the tablet's camera | A scanner types the code like a keyboard, so it needs no setup |
| Label printer | Rollo, Zebra ZD421/ZD621 or GK420d, DYMO LabelWriter 4XL or 5XL, Brother QL-1100 | Prints product labels and 4x6 shipping labels on thermal stock |

## Card readers

The register takes card-present payments on Stripe's smart readers:

| Reader | Notes |
| --- | --- |
| **Stripe Reader S700** / **S710** | Android-based smart reader for the countertop or the hand. |
| **Stripe Reader T600** | Countertop smart reader, on Wi-Fi or on Ethernet with the hub. |
| **BBPOS WisePOS E** | Countertop smart reader. |

All are sold by Stripe. They are smart readers: each one talks to Stripe
over its own internet connection, so it does not need to be plugged into
or paired by Bluetooth with the device the register runs on. Card readers
are shown in the console only when they are available for your store.

**Getting a reader**

Readers take payments through Aglyn's Stripe account, which pays your
store out, so a reader is registered to your store in Aglyn rather than
in a Stripe Dashboard of your own. Any supported reader can be added with
the pairing code it shows, including one that was registered somewhere
else before: generating a new pairing code on the reader and adding it
here moves it to your store.

Where the **Hardware** card is available, you can buy a reader from Aglyn
instead and have Stripe ship it to you; see
[Buy a reader from Aglyn](#buy-a-reader-from-aglyn).

Stripe sells its readers through the Terminal hardware shop in the Stripe
Dashboard. If you buy one there with a Stripe account of your own, add it
here with a fresh pairing code from the reader, as above. Use the pairing
code rather than the reader's serial number or order number: those two
only register a reader to the Stripe account that ordered it.

**Setting one up**

1. Charge the reader and switch it on. Stripe recommends leaving it plugged
   in and on, even when not in use, so it receives software updates.
2. Connect it to the internet: Wi-Fi from the reader's **Settings**, or
   Ethernet through Stripe's optional dock or hub. Stripe's setup guides for
   the [S700/S710](https://docs.stripe.com/terminal/payments/setup-reader/stripe-reader-s700)
   and the [WisePOS E](https://docs.stripe.com/terminal/payments/setup-reader/bbpos-wisepos-e)
   show where each setting is, including the admin passcode the reader's
   **Settings** asks for.
3. On the reader, open **Settings** and generate a pairing code.
4. In the console, add the reader on the **POS devices** card on
   **Products → Point of sale** (**Add card reader**) with that code. The steps are in
   [Card readers](pos-and-reservations.md#card-readers).

**Network notes**

- The reader must be **online** to take a payment. Its status in the
  **POS devices** card reads **Online** or **Offline**, and the register
  warns you before you charge an offline reader.
- The reader does not need to be on the same network as the register; it
  only needs its own internet connection. A wired connection through the
  dock or hub is the steadier choice at a busy counter.
- If a payment will not start because the reader is offline or busy,
  check that it is on and connected, cancel the payment, and take it again
  — or use **Card (QR)** or **Type card** for that sale.


### Reader start-up screen {#reader-start-up-screen}

While a Stripe Reader S700, S710 or BBPOS WisePOS E waits for a payment, it
shows a start-up screen. Choose what yours show under **Reader start-up
screen** on the **POS devices** card:

- **The Aglyn start-up screen** — the default.
- **Your logo** — the logo from your organization profile, centered on a white
  screen. If the profile has no logo yet, the card links to it. A square logo
  with a little space around it looks best.
- **Your own image** — a full-screen picture from your media library. It must
  be a portrait image shaped 9:16, at least 1080 × 1920 pixels, as a PNG, JPEG
  or WebP; the card refuses any other shape before saving. It is sized for each
  reader's screen for you.

A workspace on a white-label plan never shows the Aglyn screen: its readers
show its own logo unless it picks an image.

Your choice goes to every reader on the site, including ones you add later.
Readers pick up a change within about ten minutes. When you save a new logo on
your organization profile or your white-label brand, it goes to the readers of
every store in the workspace straight away, without holding up the save, and
reaches them within about ten minutes. If you replace the logo's file in your
media library instead, your readers get it within about half an hour; open the
**POS devices** card to send it right away. Anyone with the **Registers and
devices** permission can change the choice.

## Buy a reader from Aglyn {#buy-a-reader-from-aglyn}

:::note Rolling out
Buying readers from Aglyn is **not yet available** on aglyn.com-hosted
workspaces. Until it is, no **Hardware** card appears on **Products → Point of
sale**; buy a reader from Stripe and add it with its pairing code, as in
[Getting a reader](#card-readers).
:::

The **Hardware** card on **Products → Point of sale** sells Stripe's card readers
and their accessories. Aglyn places the order with Stripe, and Stripe ships it
straight to you. Because Aglyn sells it, the reader is ready to take payments
through Aglyn: add it to a register with its pairing code when it arrives.

**What's on offer**

| Item | What it's for |
| --- | --- |
| **Stripe Reader S710** | Handheld with its own 4G connection, for events and parking lots |
| **Stripe Reader S700** | Handheld or countertop reader on Wi-Fi |
| **Stripe Reader T600** | Countertop reader on Wi-Fi, or on Ethernet with the hub |
| **BBPOS WisePOS E** | Countertop reader on Wi-Fi |
| **Stripe Reader M2** | Pairs with the Aglyn POS app on your phone or tablet by Bluetooth |
| Charging docks for the S700/S710, the WisePOS E and the M2, and the M2 mount | Keep a reader charged and in place at the counter |
| The Stripe Reader Hub | Connects an S700, S710 or T600 to Ethernet and power |
| A case for the S700/S710, and spare cables and chargers | Protect a handheld reader, or replace a lost cable or charger |

The card shows only what is available to order, with its price. Stripe may stop
selling the BBPOS WisePOS E, and the card says so beside it.

**Place an order**

1. Open **Products → Point of sale** and find the **Hardware** card.
2. Choose a quantity for each item, up to 10 of each and 20 items in one order.
3. Choose a shipping speed. The summary shows the items, shipping and, where tax
   applies, says it is calculated at checkout.
4. Select **Check out** in the card's header. Enter the shipping address, a
   phone number for the carrier, and your card on the secure checkout page, and
   pay.

You come back to the card, which says the order is in. Orders ship to street
addresses in the United States; P.O. boxes and military addresses are not
accepted.

#### Who can buy hardware {#who-can-buy-hardware}

Placing an order needs the **Buy point of sale hardware** permission. Owners,
admins and editors hold it with the point of sale, and viewers don't. It stands on
its own:

- To keep ordering to a few people, deny it in a
  [custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md#point-of-sale-permissions)
  or for one member. They still see the card and the orders, and **Check out** says
  why it is unavailable.
- To let someone order readers without working the register, such as a
  bookkeeper, allow it for them. They open **Products → Point of sale** and see the
  **Hardware** card and the site's orders, and nothing at the register.

**Follow an order**

**Your orders** on the card lists every hardware order placed from this site,
newest first, and sorts by any column. Each order moves through:

| Status | Meaning |
| --- | --- |
| **Order received** | Paid. Aglyn is placing it with Stripe. |
| **Being prepared** | Stripe has the order and is getting it ready to ship. |
| **Shipped** | On its way. The tracking number links to the carrier's tracking page. |
| **Delivered** | It has arrived. |
| **Set up** | The reader is registered for your store. |
| **Canceled** or **Refunded** | The order was stopped before it shipped, and the payment was returned to your card. |

You get an email when the order is received, when it ships (with the carrier and
a tracking link), and when it is delivered (with the steps to set the reader
up). To change or cancel an order before it ships, contact support.

**When it arrives**

Set the reader up as in [Setting one up](#card-readers): charge it, connect it to
Wi-Fi, generate a pairing code on the reader, and add it on the **POS devices**
card. A Stripe Reader M2 pairs by Bluetooth from the Aglyn POS app instead.

**Who can buy:** a member with the **Buy point of sale hardware** permission for
the site, on a plan that includes POS.

### Bought from us in person {#bought-from-us-in-person}

At an event, Aglyn may sell you a reader in person. You pay at Aglyn's register,
take the reader with you, and the order joins your workspace:

- **If you have an account**, Aglyn's staff look you up by your email address,
  your name or your workspace's name, and attach the reader to the workspace you
  choose, and to a store when you pick one.
- **If you don't have an account yet**, you get an email inviting you to create
  one with the same address. Once you create your workspace, the reader is in it.
  There is nothing to accept.

The reader then waits on **Products → Point of sale**, in a **Card readers to set
up** card, which says what it still needs:

1. **A plan that includes the point of sale.** A reader takes payments at the
   register, so the card asks you to add it first, with a link to the plans.
2. **The store it is for**, when nobody chose one at the event. Pick it under
   **Which store is it for?** and select **Choose**.
3. **Adding it on the store's POS devices card** with the pairing code it shows,
   as in [Setting one up](#card-readers). The first reader on a store asks for
   the store's address.

If Aglyn's staff took the reader's serial number when you bought it, the order
moves to **Set up** by itself as soon as you add the reader. Otherwise, or for a
Stripe Reader M2 you pair by Bluetooth, select **Mark set up** when it is done.
Staff can also add the reader to your store for you at the event, by its pairing
code, while you are there.

The order is in your purchase history on the **Hardware** card, under **Your
orders**, even before buying online is open for your workspace.

**Returning one.** Returns follow Stripe's hardware terms, and the return shipping
is yours to pay. There are three ways:

- Bring it to Aglyn's register at a later event. The refund goes back the way
  you paid.
- On the **Hardware** card, under **Your orders**, select **Request a return** on
  the order and say why. Aglyn's team arranges the return with you, then refunds
  it to the card you paid with, or tells you why it can't. The order shows
  **Return requested**, then **Returned** or **Return declined**.
- Aglyn's team can also refund it to the card you paid with at any time.

A reader paid for in cash is refunded at Aglyn's register.

### If the workspace or your account closes before an order ships {#hardware-orders-at-closure}

When a workspace is
[deleted](../../workspace-and-billing/billing-and-plans/downgrading-and-canceling.md#deleting-your-organization),
every hardware order it placed that has not shipped yet is canceled and the
full amount, shipping and tax included, is refunded to the card it was paid
with. The same happens to the orders a person placed when they
[close their account](../../workspace-and-billing/manage-account.md#close-account-deleted).
The person who placed the order gets an email saying it was canceled and
refunded. The workspace deletion or the account closing goes ahead right away;
it never waits for an order. Orders that have already shipped are not
affected.

You are told before you confirm. The **Delete organization** card, and the
**Close your account?** dialog, list every order that will be canceled and
refunded — its order number, what is in it and the amount — above the confirm.
They don't stop you: keep the workspace or the account if you still want the
order.

### Records of your purchases {#hardware-purchase-records}

Aglyn is the seller of these readers, so it keeps a record of each sale for tax
and accounting: the items and their prices, shipping, tax, the total, the order's
status dates, Stripe's payment references, and the state, ZIP code and country it
shipped to. That record stays after the workspace is
[deleted](../../workspace-and-billing/billing-and-plans/downgrading-and-canceling.md#deleting-your-organization),
and is kept for seven years from the sale, then deleted. It never holds the
buyer's name, email, phone, street address or tracking number. If an order is
canceled and refunded, the record says so.

For a reader bought from Aglyn in person, the record names Aglyn's register sale
and how it was paid instead of a shipping address, and the tax is the one Aglyn's
store charged at the sale.

If the person who placed an order
[closes their account](../../workspace-and-billing/manage-account.md#close-account-deleted),
the workspace keeps the order and its amounts, and their name, email, phone,
street address and the tracking are removed from it.

## Receipt printers

A cloud receipt printer collects its work from Aglyn over the internet, so a
receipt prints from the register on any device, even one with no printer driver,
and even when the printer is on a different network. Each printer belongs to one
register.

Star printers use **CloudPRNT** and Epson printers use **Server Direct Print**.
Both come built into the models above.

### Add a printer

1. Open **Products → Point of sale**. Each register has a **Hardware** card.
2. Select **Add printer** on the register's card and choose the brand.
3. Enter the model, a name such as *Counter printer*, and the printer's identity:
   - **Star:** the printer's **MAC address**. Hold the **FEED** button while you
     switch the printer on to print a self-test; the MAC address is on it. Use the
     Ethernet MAC even when the printer is on Wi-Fi.
   - **Epson:** any **ID** you choose, such as `counter-1`. You enter the same ID
     in the printer in step 5.
4. Choose the paper width, whether the printer prints a receipt for every sale,
   whether it prints kitchen tickets, and whether a cash drawer is plugged into
   it. Select **Add printer**. The card
   shows the printer's **URL**. Copy it.
5. Enter the URL in the printer's own settings page (open the printer's IP
   address, from the self-test, in a browser on the same network):
   - **Star:** sign in (user `root`; the password is `public` or the one on the
     printer's label), go to **Settings → CloudPRNT**, turn CloudPRNT on, paste the
     URL as the **Server URL**, set the polling interval to **5 seconds**, then
     **Submit** and **Save → Restart device**.
   - **Epson:** in **EPSON TMNet WebConfig**, open **Server Direct Print** (under
     **Web Service Settings** on most models). Select **Enable**, enter the **ID**
     from step 3, paste the URL as the **Server 1 URL**, set the interval to
     **5 seconds**, select **Submit**, and reset the printer.
6. Within a minute the printer shows **Online** on the card. Select **Test print**.

:::warning Keep the URL private
The URL is the printer's password: whoever has it can collect this register's
receipts. If it is ever shared, open the printer's **Settings** and select
**Regenerate URL**, then enter the new URL in the printer. The old one stops
working at once.
:::

### What prints

- **Every sale**, when the printer is set to print a receipt for every sale: the
  store name and address, the order number, each item with its price, the
  subtotal, discount, tax, tip and total, how it was paid and the change, and a
  barcode of the order number that a scanner can read back. When the customer
  asks for an emailed or texted receipt, or no receipt, no paper prints. When
  they ask for a printed one and no printer prints every sale, the register's
  first printer prints it.
- **Kitchen tickets**, on a printer set to print them: the order number in large
  type, the time and the register, and each item with its quantity and options,
  with no prices. Put one in the kitchen, at the bar or on the packing bench.
- **The last sale's receipt**: select **Receipt printer** under the register's
  last sale when the customer asks for paper after all. It prints once: a receipt
  that already printed for that sale is not printed again.
- **Reprints**: open any register order under **Commerce → Orders** and select
  **Receipt printer**. A reprint is marked *REPRINT*.
- **X and Z reports**, from the register's shift, on the printer that prints
  receipts. See [Running the register](pos-operations.md).
- A **test page** from the Hardware card.

A receipt waits up to 30 minutes for its printer, and a kitchen ticket up to 10. If the printer is off or out of
paper for longer, the job is marked **Expired** and you can reprint it.

### Your logo on the receipt

Printers keep a logo in their own memory. Store your logo with **Star Quick Setup
Utility** or **Epson TM Utility**, then enter its number (Star, such as `1`) or key
(Epson, such as `48,48`) in the printer's **Settings** on the Hardware card.

### Status

The Hardware card shows what each printer last reported: **Online**, **Paper
low**, **Out of paper**, **Cover open** or **Printer error**. A printer that has
not checked in for two minutes shows **Offline**. **Recent print jobs** lists what
was sent, whether it printed, and why it did not. A job the printer has not
collected yet can be canceled.

If a job fails, the printer retries it up to three times before it is marked
**Failed**.

## Cash drawer

Plug the drawer's RJ12 cable into the **DK** (drawer kick) port on the back of the
printer, and turn on **A cash drawer is plugged into this printer** in the
printer's settings. The drawer then opens:

- on every sale paid **in cash**, including a sale paid partly in cash and partly
  by card, as the receipt starts printing (or on its own when that printer does
  not print receipts),
- when the shift records cash **paid in**, **paid out** or **dropped to the safe**,
  and when a return is refunded in cash,
- from **Open drawer** on the Hardware card.

A drawer only opens within two minutes of the sale that asked for it. If the
printer was offline for longer, the drawer stays shut rather than springing open
later at an unattended counter.

## Barcode scanning

- **USB or Bluetooth scanners** work with no setup: the scanner types the code
  and presses Enter, and the register adds the product whose barcode or SKU
  matches. It works whether or not the search box has focus, so you can scan
  straight after tapping a product or a button. A scan made while a payment
  window is open is ignored. Set the scanner to send **Enter** after each code;
  most do out of the box.
- **The camera** works on a tablet or phone: select the scan button beside the
  register's search box, or beside a variant's **Barcode** field in the product
  editor, and hold the barcode inside the frame. The camera reads EAN-13, UPC-A,
  EAN-8 and Code128 everywhere. Chrome on Android and on a Mac also reads UPC-E,
  Code 39 and QR codes. The first time, allow the browser to use the camera.

For a busy counter, a handheld scanner is faster than the camera.

## Label printers

### Product labels

Print price and barcode labels for your shelves and stock:

1. Go to **Commerce → Catalog** and select **Labels** on a physical product.
2. Choose the label size, **2.25 x 1.25 in** or **2 x 1 in**, and how many copies
   of each variant to print. Each label carries the product name, the variant's
   options, its price, and a barcode of the variant's barcode, or of its SKU when
   it has no barcode. A variant with neither cannot print a label; add one in the
   product editor first.
3. Select **Print**, choose the label printer and the same label size in the
   print dialog, and print at **100%** scale. Or select **Download ZPL** and send
   the file to a Zebra printer (with Zebra Setup Utilities, for example), which
   prints it without a print dialog.

A valid EAN-13, UPC-A or EAN-8 prints as that symbology; any other code prints
as Code 128. Every label scans back at the register, with a handheld scanner or
the camera.

### Shipping labels

Shipping labels bought through [Pirate Ship](use-pirate-ship.md) or
[ShipStation](use-shipstation.md) come as 4x6 inch PDFs, which any thermal label
printer prints from the browser:

1. Install the printer's driver (Rollo, Zebra, DYMO and Brother all provide one
   for Mac and Windows) and load 4x6 labels.
2. Open the label PDF and print it. In the print dialog choose the label printer,
   the **4x6** (or 100 x 150 mm) paper size, and **Actual size** or **100%**
   scale, never *Fit to page*.
3. Print one label to check the barcode is sharp and nothing is cut off. The
   browser remembers these settings for the next label.

## Customer display tablet

Any tablet with a modern browser can be the customer display. It needs an
internet connection, but not a sign-in: you pair it with a code from the
register, as described in
[Customer display](pos-and-reservations.md#customer-display).

For a counter that runs all day:

- Put the tablet on a stand facing the customer; landscape gives the
  basket and the tip buttons the most room.
- Keep it plugged in, and set the tablet not to sleep or lock while the
  display page is open.
- Use the tablet's own single-app or guided-access mode, if it has one, so
  customers cannot leave the display page.
- Add the display page to the home screen or bookmark it, so it can be
  reopened quickly after a restart. A paired display stays paired until
  you sign it out on the **POS devices** card on **Products → Point of sale**, remove its
  register, or clear the tablet browser's data for the console.


## Related

- [POS & reservations](pos-and-reservations.md)
- [Running the register](pos-operations.md)
- [Product catalog](catalog.md)
