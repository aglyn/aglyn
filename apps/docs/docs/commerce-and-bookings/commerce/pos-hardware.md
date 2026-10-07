---
sidebar_position: 3.5
title: POS hardware
description: Receipt printers that print from any device with no driver, a cash drawer that opens on cash sales, camera and USB barcode scanning, and 4x6 label printers.
---

# POS hardware

The register runs in a browser, so it works on an iPad, an Android tablet, a
laptop or a desktop at the counter. This page covers the hardware around it:
a receipt printer, the cash drawer, barcode scanners and a label printer.

:::info Plan availability
POS hardware comes with POS, on **Pro** and above. There is no extra charge for
printers or scanners.
:::

## Recommended kit

| Device | Recommended | Why |
| --- | --- | --- |
| Register | iPad (10th gen or newer) or an Android tablet on a stand | Touch-first, and the camera scans barcodes |
| Receipt printer | **Star mC-Print3** or **Star TSP143IV** (CloudPRNT), or **Epson TM-m30III** (Server Direct Print) | Prints from any device over the internet: no driver, no pairing, no app |
| Cash drawer | Any 24 V drawer with an RJ12 cable, such as the Star CD3-1616 or the APG Vasario | Plugs into the printer's drawer port and opens when the printer tells it to |
| Barcode scanner | Any USB or Bluetooth scanner in keyboard mode, or the tablet's camera | A scanner types the code like a keyboard, so it needs no setup |
| Label printer | Rollo, Zebra ZD421/ZD621 or GK420d, DYMO LabelWriter 4XL or 5XL, Brother QL-1100 | Prints 4x6 shipping labels on thermal stock |

## Receipt printers

A cloud receipt printer collects its work from Aglyn over the internet, so a
receipt prints from the register on any device, even one with no printer driver,
and even when the printer is on a different network. Each printer belongs to one
register.

Star printers use **CloudPRNT** and Epson printers use **Server Direct Print**.
Both come built into the models above.

### Add a printer

1. Go to **Commerce → Settings**. Each register has a **Hardware** card.
2. Select **Add printer** on the register's card and choose the brand.
3. Enter the model, a name such as *Counter printer*, and the printer's identity:
   - **Star:** the printer's **MAC address**. Hold the **FEED** button while you
     switch the printer on to print a self-test; the MAC address is on it. Use the
     Ethernet MAC even when the printer is on Wi-Fi.
   - **Epson:** any **ID** you choose, such as `counter-1`. You enter the same ID
     in the printer in step 5.
4. Choose the paper width, whether the printer prints a receipt for every sale,
   and whether a cash drawer is plugged into it. Select **Add printer**. The card
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
  barcode of the order number that a scanner can read back.
- **Reprints** of any register order.
- A **test page** from the Hardware card.

A receipt waits up to 30 minutes for its printer. If the printer is off or out of
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

- on every **cash sale**, as the receipt starts printing,
- from **Open drawer** on the Hardware card.

A drawer only opens within two minutes of the sale that asked for it. If the
printer was offline for longer, the drawer stays shut rather than springing open
later at an unattended counter.

## Barcode scanning

- **USB or Bluetooth scanners** work with no setup: the scanner types the code
  into the register's search box and presses Enter, and the register adds the
  product whose SKU or barcode matches.
- **The camera** works on a tablet or phone: select the scan button beside the
  register's search box, or beside a variant's **Barcode** field in the product
  editor, and hold the barcode inside the frame. The camera reads EAN-13, UPC-A,
  EAN-8 and Code128 everywhere. Chrome on Android and on a Mac also reads UPC-E,
  Code 39 and QR codes. The first time, allow the browser to use the camera.

For a busy counter, a handheld scanner is faster than the camera.

## Label printers

Shipping labels are 4x6 inch PDFs, which any thermal label printer prints from
the browser:

1. Install the printer's driver (Rollo, Zebra, DYMO and Brother all provide one
   for Mac and Windows) and load 4x6 labels.
2. Open the label PDF and print it. In the print dialog choose the label printer,
   the **4x6** (or 100 x 150 mm) paper size, and **Actual size** or **100%**
   scale, never *Fit to page*.
3. Print one label to check the barcode is sharp and nothing is cut off. The
   browser remembers these settings for the next label.

Zebra printers can also print **ZPL** labels directly, which is faster and
sharper than a PDF; use ZPL when your carrier offers it and the printer is a
Zebra.

## Related

- [POS & reservations](pos-and-reservations.md)
- [Product catalog](catalog.md)
