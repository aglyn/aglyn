---
sidebar_position: 3.5
title: Running the register
description: Shifts and the cash drawer with X and Z reports, staff PINs, customers at the register, returns and exchanges, and printed thermal receipts.
---

# Running the register

Everything a till needs between the first sale of the day and the last: a
counted cash drawer, a quick way to change who is ringing, the customer in
front of you, returns, and a proper printed receipt. All of it runs from the
register at **`/{site}/pos`**. Staff PINs are set under **Commerce → Settings**,
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

### Requiring a shift

Turn on **Require an open shift to sell** in **Admin → Plugins → Commerce** to have a
register refuse sales, and cash refunds, until someone opens a shift. Off by
default.

### Who rang it

Every sale records the cashier who rang it, the shift it was rung in and any
discount's author. After a PIN switch, that is the person who switched in, not
whoever is signed in on the tablet.

## Staff PINs

A shared tablet stays signed in; each person switches in with their own PIN
instead of signing out.

- Set your **4–6 digit PIN** under **Commerce → Settings → Staff PINs**. A PIN
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
the tip and change, and your **receipt footer** from Commerce → Settings. Two
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

## Related

- [POS & reservations](pos-and-reservations.md)
- [Commerce overview](overview.md)
