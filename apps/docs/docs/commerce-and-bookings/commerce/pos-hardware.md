---
sidebar_position: 3.5
title: POS hardware
description: Card readers, a customer display tablet, driverless receipt and kitchen printers, a cash drawer that opens on cash sales, camera and USB barcode scanning, and product and shipping labels.
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
| **BBPOS WisePOS E** | Countertop smart reader. |

Both are sold by Stripe. They are smart readers: each one talks to Stripe
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
4. In the console, add the reader on the **POS devices** card in the
   store's settings (**Add card reader**) with that code. The steps are in
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


## Receipt printers

A cloud receipt printer collects its work from Aglyn over the internet, so a
receipt prints from the register on any device, even one with no printer driver,
and even when the printer is on a different network. Each printer belongs to one
register.

Star printers use **CloudPRNT** and Epson printers use **Server Direct Print**.
Both come built into the models above.

### Add a printer

1. Open the store's settings. Each register has a **Hardware** card.
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
  you sign it out on the **POS devices** card in the store's settings, remove its
  register, or clear the tablet browser's data for the console.


## Related

- [POS & reservations](pos-and-reservations.md)
- [Running the register](pos-operations.md)
- [Product catalog](catalog.md)
