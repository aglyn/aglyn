---
sidebar_position: 3.5
title: Running the register
description: Shifts and X/Z reports, day and event totals, check-in with wristbands, staff PINs, customers at the register, returns and exchanges, printed receipts, and selling cash while offline.
---

# Running the register

Everything a till needs between the first sale of the day and the last: a
counted cash drawer, a quick way to change who is ringing, the customer in
front of you, returns, and a proper printed receipt. All of it runs from the
register at **`/{site}/pos`**. Staff PINs are set on **Products → Point of sale**,
and the register's rules under the site's **Admin → Plugins → Commerce**.

:::info Plan availability
These are part of the point of sale, so they need **Pro** or above, like the
register itself. Only members who can use the register — a site **admin** or
**editor** whose **Manage POS** permission is on — can open shifts, switch in,
look customers up or take returns.
:::

## Shifts and the cash drawer

A shift is one stretch of trading on one register, counted against one cash
drawer.

1. **Open a shift** from the strip above the basket and enter the starting
   cash (the float) you counted into the drawer.
2. While it is open, every sale on that register is counted in the shift.
   Use **Cash in/out** to record cash that moves without a sale:
   - **Paid in** — cash added to the drawer, such as change from the bank.
   - **Paid out** — cash taken for an expense, with a reason.
   - **Safe drop** — cash moved from the drawer to the safe.
3. **X report** shows the shift so far at any time and changes nothing.
4. **Close shift**, count the drawer and enter what is in it. The **Z report**
   freezes the shift's figures, and the register is free for the next shift.

A register has **one open shift at a time**. If two tablets try to open the
same register at once, one opens it and the other is told a shift is already
open.

### What the reports show

Sales (orders, gross sales, discounts, tax, tips, refunds and net sales),
the same broken down **by tender** (cash, card, gift card and room charge),
and the drawer:

| | |
| --- | --- |
| Starting cash | the float you counted when the shift opened |
| + Cash sales | what cash sales took (change handed back is not counted), plus cash tips |
| + Paid in | |
| − Paid out | |
| − Safe drops | |
| − Cash refunds | returns paid out of the drawer during the shift |
| **= Expected in drawer** | |

The **variance** is what you counted minus what was expected: positive means
the drawer is over, negative means it is short. Print either report on your
receipt printer from its dialog.

### Shift history

**Commerce → Orders → Shift history** lists each register's shifts, newest
first, with net sales, expected and counted cash and the variance. Click a
closed shift for its Z report, and use **Export CSV** for a spreadsheet of the
shifts listed.

## Day and event totals

When several people take payments on their own registers, **Commerce → Orders
→ Day totals** adds the whole day up across every register, shift and cashier.
It opens on today, counted in your site's time zone. Pick **From** and **To**
dates to see another day or a whole event, up to 31 days at a time, and
**Today** to come back.

- **Totals:** orders, gross sales, discounts, tax, tips, refunds and net sales.
  Only sales rung at a register count; online orders don't.
- **By tender:** cash, card, gift card, room charge and store credit, each with
  what it took, what was refunded to it, and the net.
- **By register** and **by cashier:** each register's and each staff member's
  orders, gross sales, tips, refunds and net sales. Every table sorts by any of
  its columns.
- **Cash drawers:** the starting cash of the shifts that opened on those days,
  cash sales, paid in, paid out, safe drops and cash refunds, then what the
  closed drawers should have held against what was counted, and whether
  they came up short or over. Drawers still open show what they should hold
  now.
- **Shifts:** every shift that opened, closed or was still open on those
  days, with its register, times, starting cash, net sales, expected and
  counted cash and the variance.

Sales count on the day they were rung, and refunds on the day they were
given back, whenever the sale was. **Export CSV** downloads the report as a
spreadsheet, and **Print** prints it on an 80 mm receipt printer like a Z
report.

Day totals need the point of sale on your plan, and only members who can use
the register can see them.

### Requiring a shift

Turn on **Require an open shift to sell** in **Admin → Plugins → Commerce** to have a
register refuse sales, and cash refunds, until someone opens a shift. Off by
default.

### Who rang it

Every sale records the cashier who rang it, the shift it was rung in and any
discount's author. After a PIN switch, that is the person who switched in, not
whoever is signed in on the tablet.

## Check-in at the window

For a track, a campground, a lot or an event: people who bought a day pass,
camping or parking online, or at the register, are looked up at the window,
checked in and handed a wristband.

**Choose what needs check-in.** In the product editor, under **Check-in**, turn
on **Needs check-in** for a ride pass, a camping spot or parking. **People per
item** says how many people one item admits: buy 3 of a pass with 1 person per
item and that is 3 check-ins; a family camping spot set to 4 admits 4. A
product with options can set each variant on its own, so a spectator ticket on
the same product needs no wristband. Turning it on also covers what was
already sold today.

**What is due on a day.** Each paid order's check-in items are due on the day
the order was placed, counted in your site's time zone, whether it was bought
online or at the register. A product has no date of its own, so a pass bought
today is for today. Guests whose stay covers the day are due too, one
check-in for each day of the stay. An item refunded on its own, or an order
refunded in full or canceled, is no longer due; anyone already checked in
stays on the list.

**At the register,** tap **Check in**, then search by name, email, phone (or
its last four digits) or order number. Pick the customer to see each person
their passes, camping and stays cover today. Type an optional **wristband
number** and pick a **color**, then tap **Check in**, or **Check in all**.
Someone already checked in shows when and by whom ("Already checked in at
9:14 AM by Sam"), and **Undo** takes a check-in back. After a PIN switch, the
check-in is recorded under the person who switched in. On a day you are
checking people in, attaching a customer to a sale who has someone due today
offers **Check in** on the customer panel too.

**Commerce → Orders → Today's check-ins** lists everyone due on a day with
what they are checked in for, the time, who checked them in and the
wristband, with expected, checked-in and still-to-come counts. Pick a **Day**
to see another one. Every column sorts, **Export CSV** downloads the list as
a spreadsheet, and **Print** prints it on an 80 mm receipt printer.

An order placed online shows up at the window within about 30 seconds; a sale
at the register shows up the moment it is paid. Check-in needs the point of
sale on your plan, and only members who can use the register can check people
in or see the list.

## Staff PINs

A shared tablet stays signed in; each person switches in with their own PIN
instead of signing out.

- Set your **4–6 digit PIN** on the **Staff PINs** card on **Products → Point of sale**. A PIN
  that is one digit repeated or a straight run like 1234 is refused.
- At the register, tap **Switch cashier**, pick your name and enter your PIN.
  Every sale, shift and return you ring is recorded under you until someone
  else switches in.
- A PIN **never grants more than your role**: the register checks your role
  and your Manage POS permission each time it is used, so removing someone's
  access takes effect on their next tap.
- **Five wrong PINs** in a row lock that person out for 15 minutes. A
  workspace admin can reset or remove anyone's PIN, which also lifts a
  lockout.
- **Lock the register after (minutes idle)** in Admin → Plugins → Commerce locks the
  register after that long without a tap, so the next person has to enter
  their PIN. Tap **Lock** to lock it yourself.

PINs are stored only as salted hashes and nobody can read them back, not even
a workspace admin.

## Customers at the register

Search the **Customer** field by name, email or phone to attach a customer to
the sale. The register shows how many orders they have placed at your store
and what they have spent. The order is saved under their email and their
name, so it appears on their record, prints their name on the receipt and can
have its receipt emailed.

**New customer** adds someone in a few taps (an email is required, a phone is
optional). Adding a customer does not sign them up for marketing email.

The search reads the people your workspace keeps in the CRM. Without it you
can still type an email for the receipt.

## Returns and exchanges

Tap **Return** on the register, then type the order number, **scan the
barcode** at the foot of the receipt, or enter the customer's email.

1. Pick the items coming back, how many of each, and the reason.
2. Leave **Put the items back in stock** on to restock them at the register's
   location.
3. Refund. The money goes back to how the customer paid:
   - **Card** — refunded through Stripe to the same card.
   - **Cash** — paid out of the drawer; the register tells you how much to
     hand over, and the open shift counts it.
   - **Gift card** — added back to the same gift card. A voided or frozen gift
     card cannot take a refund.
   - **Room charge** — taken back off the stay's folio.

A sale paid more than one way is refunded to cards first, then gift cards and
room charges, and to cash last. Turn on **Split by hand** to choose the amounts
yourself; a payment can never take back more than it paid.

Each unit's refund is its price less its share of any discount, plus its
share of the tax, so returning items one at a time refunds exactly what
returning them together would.

Every register return is also listed under [**Returns**](orders-and-returns.md#returns), beside the returns
customers ask for online, already marked refunded. Items a customer has
already asked to return online are held for that return: the register shows
them as **In an online return** and will not refund them a second time.

**Exchanges:** after the return, tap **Ring up the exchange** to start a new
sale for the same customer.

### Refund limits and manager approval

**Cashier refund limit ($)** in Admin → Plugins → Commerce is the largest return a
cashier may refund without a manager. It is **$0 by default**, so every
register refund needs a manager until you raise it. Above the limit the
register asks a **workspace admin** to enter their PIN to approve that one
refund. Workspace admins have no limit.

## Printed receipts

Receipts print on any 80 mm receipt printer through your browser's print
dialog. Each receipt has your logo and store name, the order number and its
barcode, the date, cashier and register, the customer's name, every item,
discounts, tax, the total, how it was paid (card with its last four digits),
the tip and change, and your **receipt footer** from **Products → Checkout**. Two
more lines are set in **Admin → Plugins → Commerce**: **Address on printed
receipts**, printed under your store name, and **Return policy on printed
receipts**, printed at the foot.

- After each sale, the register shows **Print receipt** and **Gift receipt**
  for that sale until the next one completes.
- **Gift receipt** prints the items and the barcode without any prices.
- **Reprint** any register sale from its order on the **Orders** page: open
  the order and use **Print receipt** or **Gift receipt**.

Most network receipt printers open the cash drawer cabled to them whenever
they print, so printing a cash sale's receipt also opens the drawer. That is a
setting on the printer.

## Selling while offline

When the register loses its connection it keeps selling **cash**. A banner
across the top of the register says it is offline and how many sales are
waiting on the device.

- **What still works:** the product grid, search and barcode scans (from the
  catalog the register saved while it was online), the basket, the cashier's
  discount up to your register limit, your store's own tax rate, and cash. The
  receipt prints through the browser's print dialog, and its barcode is the one
  the order answers to once it syncs.
- **What is off until the connection returns:** card readers, Tap to Pay,
  typed cards, the QR card link, **gift cards**, store credit and rewards,
  room charges, discount codes and store promotions. Card payments need the
  connection, a gift card or store credit balance can only be checked online,
  so neither is redeemed offline, and codes and promotions are counted against
  their limits online.
- **When the connection returns,** the register sends its saved sales on its
  own. Each one becomes a paid order, dated when it was rung, in the shift it
  was rung in and under the cashier who rang it. The emailed receipt goes to
  the customer then. Cloud receipt printers print nothing for a synced sale,
  and its drawer does not open again.
- **A sale is never lost and never counted twice.** It stays on the device
  until your store has recorded it, and sending it again (a connection that
  comes and goes) records it once.

### What the sync checks

The customer has already paid, so the sync records the sale as it was rung
and says what you should look at, on the order and in the register:

- **Stock that went short**: more was sold than the shelf held, for example
  because the website sold the last one meanwhile. The order lists the item
  and how many were short.
- A **price** that changed after the register saved the catalog (the sale
  keeps the price it was rung at), or a product deleted since.
- A **shift closed** before the sale synced, so its Z report does not include
  that cash.
- A discount above the register's limit, tax that differs from your store's
  rate now, or a device clock that was wrong.

### Before you go offline

- The register needs to have been online on that device once, so it has the
  catalog and your store's rules. It refreshes them regularly while online.
- Your store needs a tax setting (your own rates, or no tax). A store using
  Stripe Tax cannot ring in-person sales, online or offline.
- If your site requires an open shift, open it before the connection drops.
- Offline sales are kept in the browser on that device, for the member who was
  signed in. In a private window, or where the browser blocks site data, the
  register says offline selling is unavailable.
- Keep the register page open. Reloading the page while offline shows the
  console's offline page; the saved sales are kept and send when you open the
  register again with a connection.
- A sale syncs only for the member who was signed in when it was rung.
- PINs are checked online, so a register that locks itself while offline
  stays locked until the connection returns. Set the auto-lock to suit how
  you trade.

## Related

- [POS & reservations](pos-and-reservations.md)
- [Commerce overview](overview.md)
