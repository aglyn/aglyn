---
sidebar_position: 3
title: POS & reservations
description: Sell in person from the console register and take date-range reservations with deposits.
---

# POS & reservations

:::info Plan availability
POS requires **Pro** or above. The number of **registers** a site can run at
once follows your plan — Pro 1, Business 2, Advanced 5 — plus any additional
register seats you've assigned to **that site**. A seat is bought once for the
workspace and then placed on one site, so buying one does not raise the limit
everywhere; see [Assigning register seats](../../workspace-and-billing/billing-and-plans/add-ons.md#assigning-register-seats).
Opening more browser tabs does not give you more registers; each sale runs
through a register you've created.
:::

![The point-of-sale page](/img/commerce/pos-page.png)

## Registers

Create your registers under **Products → Point of sale → POS registers** — one
per till or device that takes in-person payments. Before your first
register exists, the register page and the **POS devices** card each show
an **Add a register** button that takes you there. Give each a name (and,
if you use inventory locations, the location it sells from). Every POS sale
is tagged with its register so you can reconcile end-of-day takings per
till. Your plan caps how many registers you can run; add more with the
[register add-on](../../workspace-and-billing/billing-and-plans/add-ons.md) in
Billing. If you downgrade below your register count, the
extra registers (newest first) stop taking payments and show **Over plan
limit** until you remove them or upgrade again — none are deleted.

## Who can do what at the register {#who-can-do-what-at-the-register}

Anyone with the **Use the point of sale** permission for the site can open the
register. The permission decides on its own: owners, admins and editors hold it by
default and viewers don't, and a site viewer you grant it in a custom role or for
one member works the register too. Five finer permissions then decide which of its
jobs are theirs:

| Permission | What it covers |
| --- | --- |
| **Sell at the register** | Ringing up sales and taking payment, at the register, the kiosk and the Aglyn POS apps |
| **Refunds and returns** | Refunding point of sale orders at the register, up to its refund limit, and taking returns and exchanges |
| **Give discounts at the register** | The register's **Discount %**. A shopper's discount code and the store's own promotions apply without it |
| **Cash drawer and shifts** | Opening and closing shifts, cash in and out, X and Z reports, and opening the drawer without a sale |
| **Registers and devices** | Adding, changing and removing card readers, receipt printers and customer displays, and the reader start-up screen |

Each one follows **Use the point of sale** until you set it, so everyone who could
use the register keeps exactly what they had. To narrow one, for example a
cashier who rings sales but does not refund, deny it in a
[custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md#point-of-sale-permissions)
or for one member. A control someone does not hold stays on screen, disabled,
with the reason. A cashier switched in with a PIN needs **Sell at the register**
too.

The register belongs to its site. An editor who works across the whole workspace
but has **Viewer** or **Author** access to one site doesn't work that site's
register, while keeping it on every other site. To let them sell there anyway,
choose **Permissions** beside them on that site's **Users** card and allow **Sell at
the register** (or **Use the point of sale** for the whole register). To let them
keep the register on every such site, set the permission to **Keep this permission**
on their custom role or their own **Permissions** — see
[A site's access narrows its register and waivers](../../workspace-and-billing/teams-and-roles/custom-roles.md#site-access-narrows).
**Buy point of sale hardware** is the workspace's, so it doesn't change.

**Buy point of sale hardware** follows **Use the point of sale** the same way, and
also stands on its own, so someone can order readers without working the register.
See [Who can buy hardware](pos-hardware.md#who-can-buy-hardware).

## The register

Open **`/{site}/pos`** in the console for a touch-first register. Pick which
register you're on at the top of the panel (skipped automatically when you
have only one):

- **Product grid** — photo tiles with the price, a stock note when only a
  few are left or none, and a count of how many are already in the basket.
  Tap a product to add it. A product with variants or modifiers opens a
  sheet first: pick the size (or other option), the modifiers, and the
  quantity, and the **Add** button shows the line's price as you go. A
  required modifier must be picked before the item can be added. The grid
  shows your first 500 active products by name; typing in the search box
  finds a product by the start of a word in its name across the whole
  catalog.
- **Quick keys** — the **★ Quick keys** chip, first in the category bar,
  shows only the products you marked **Quick key at the register** in the
  product editor: your best sellers, one tap away. Each register device
  reopens on the chip it was left on. Typing in the search box searches the
  whole catalog, not just the quick keys.
- **Categories** — the chips after **All** show one category each.
- **Changing a line** — tap a line in the basket to change its variant,
  modifiers or quantity (type a number or use **+** and **−**), or remove
  it. The **+** and **−** beside each line change the quantity by one.
  Two of the same item with the same choices are one line; the same item
  with a different choice is a line of its own.
- **Barcode scanners** — any keyboard-wedge scanner works: it types the
  code into the search box and presses Enter, which adds the exact
  SKU/barcode match, variant included. A product with modifiers opens its
  sheet with that variant already picked. No drivers or pairing needed.
- **Charge** — when the basket is ready, tap **Charge**. That prices the
  sale (tax is added at this step) and opens it for payment; the panel then
  shows the **balance due** and the ways to pay. While a sale is open the
  basket is locked: finish it or void it before ringing up the next one.
- **On a tablet** — at 900px wide and up, the product grid and the register
  sit side by side. On a narrower screen the register becomes a sheet that
  slides up from the bottom, behind a bar that always shows the total and
  the **Charge** button.

### Modifiers

Modifiers are choices added to an item as it is rung up, such as a milk, an
extra shot or "no onions", that are not stocked variants. Set them in the
product editor under **At the register**:

1. **Add modifier group** and name it (for example "Milk").
2. Set **At least** — 0 makes the group optional, 1 or more makes it
   required — and **At most**, the number of choices that can be picked (1
   for "pick one").
3. **Add choice** for each option, with what it **Adds** to the price
   (blank is free).

The register adds each chosen modifier's price to the item, and the choices
print after the item's name on the receipt, the order and the customer
display. Modifiers are offered at the register only; the online store does
not show them. The **At the register** section shows only on plans that
include POS.

POS sales create normal orders tagged `pos`, decrement the same inventory
as your online store (per location if you use locations), and appear in
the orders list under the channel filter.

For the readers, scanners, printers and tablets that work with the
register, see [POS hardware](pos-hardware.md).

### Selling past the count

If a line is for more units than the count says are on the shelf, the
register says so under that line — **"Only 1 in stock — selling 2"** — and
**still lets you take the sale**. The shelf is the truth at a counter: if
the item is in your hand it exists, whatever the number says. Your managers
are notified of the shortfall so the count can be corrected afterwards with
a stock adjustment.

Products set to **allow backorders** never show this, because selling past
zero is what that setting asks for. Products with stock tracking switched
off have no count to be short against.

Online checkout is different: there, a product set to **deny** out-of-stock
purchases really does refuse.

## Taking payment

A sale can take as many payments as it needs. The amount box above the
payment buttons starts at the whole balance; to **split** the bill, type a
smaller amount and pick a tender, and the rest stays open for the next
one. Every payment is listed with its status (**Waiting**, **Approved**,
**Declined**, **Canceled**). The sale is **paid** when the balance reaches
zero, and only then is the stock taken and the order completed.

| Tender | What happens |
| --- | --- |
| **Cash** | Enter what the customer handed you, or tap **Exact** or a round-up amount. The register shows the change to give. Less than the amount due is taken toward the sale and the rest stays open. |
| **Card reader** | Sends the amount to a [card reader](#card-readers); the customer taps, inserts or swipes there. Shown only when card readers are available for your store and one is registered. With more than one reader, pick which one under the buttons. |
| **Type card** | Staff type the card into Stripe's own card form (card not present, such as an order taken over the phone). The card never touches the register, and the payment goes through Stripe's normal online checks, 3-D Secure included. In the Aglyn POS app this is **Enter card manually**: on iPhone, iPad and Mac the card goes into the app's own card fields and straight to Stripe; if a bank asks the cardholder to approve the payment, use **Card (QR)** instead so they can approve it on their phone. |
| **Card (QR)** | Shows a QR code; the customer scans it and pays on their phone, and the payment appears on the register as soon as it goes through. |
| **Gift card** | Type or scan the code. **Check balance** shows what the card can spend; **Apply card** takes the smaller of that balance and what is due, so a card worth less than the sale leaves the rest open. |
| **Room** | Charges a checked-in stay's folio. Shown only when a guest is checked in. |

**Card reader**, **Type card** and **Card (QR)** charge through your store's
Stripe account. Until Stripe is connected and able to take charges, they show
grayed out with a note above them that links to **Products → Settings →
Payments**, where you connect it. Cash, gift cards, store credit and room
charges work without Stripe.

Card payments that are still waiting can be **canceled**, which frees that
amount for another tender. If the card reader declines a card, **Retry**
sends the same charge back to the reader, so the customer can try again
or use another card.

**Void sale** cancels the whole sale and hands back everything taken on
it: card payments are refunded, gift cards re-credited and room charges
removed. Cash is the one thing the register cannot return — hand it back
to the customer yourself.

### Platform fees at the register

Your plan's platform fee is charged on **card** and **charge-to-room**
payments. **Cash**, **gift card** and **store credit** payments carry no
platform fee: cash is yours in full, the fee on a gift card is charged when the
card is sold, not again when it is spent, and store credit is value you gave
your customer, so no money changes hands.

| Payment | Platform fee | How it is collected |
| --- | --- | --- |
| Card reader, typed card, card (QR) | Your plan's rate | Deducted from your Stripe payout for that payment |
| Charge to room | Your plan's rate | No payout to deduct from, so it is added to your next monthly invoice |
| Cash | None | — |
| Gift card | None | — |
| Store credit | None | — |

A **split** sale charges the fee only on the part of the sale its card and
room-charge payments paid: a $100 sale paid $60 by card and
$40 in cash carries the fee on $60, deducted from that card's payout, and
nothing on the cash. Cash sales you ring while the register is
[offline](pos-operations.md#selling-while-offline) carry no fee either, and a
card the Aglyn POS app
[takes offline](pos-operations.md#cards-taken-offline-in-the-aglyn-pos-app)
carries the card fee, as it would online. **Tips** carry no platform fee. Stripe's own processing cost on a
card payment is passed through at cost, like any other card sale, and is
worked out on the whole charge, tip included, because that is what Stripe
charges on.

The customer never pays the fee, and the amount **Due** on the register is
the same on every tender. On plans with a 0% fee there is no platform fee
to collect either way. See
[Billing & plans](../../workspace-and-billing/billing-and-plans/overview.md#platform-fees)
for your plan's rates.

### When something disconnects

- If a card payment does not go through, **Cancel** it and take the amount
  another way — a sale never takes stock until it is paid.
- If the card reader is offline, check it is on and connected to the
  internet, or take the payment by QR or a typed card.
- Cash sales need no network round-trip beyond saving the order; if the
  console loses connection entirely, note sales on paper and enter them
  when back online.

## Tips

Tips are off until you turn them on. The settings are on your site's
**Admin → Plugins → Commerce** page, in the **Commerce settings** card:

- **Ask for tips at the register** — off by default.
- **Tip choices (%)** — up to four percentages, separated by commas.
  Defaults to 15, 18, 20, 25.

With tips on, the payment panel shows a button for each percentage and
**No tip**, so the cashier can choose one for the customer. With a
[customer display](#customer-display) paired, **Ask on display** lets the
customer pick a percentage, type an amount or choose no tip on their own
screen. When no tip has been added yet, the
[card reader](#card-readers) asks the customer itself, showing the first
three of your percentages.

A tip is added on top of the payment it rides on and can be at most that
payment's amount. Tips are yours: they are not counted as sales and carry
no platform fee.

## Receipts

When a sale is paid, the register shows the change due (for cash) and the
receipt options. **Receipts at the register**, in the same **Commerce
settings** card, decides what happens first:

| Setting | What happens when the sale is paid |
| --- | --- |
| **Ask the customer** (default) | With a customer display paired, the customer chooses email, text, print or no receipt on their screen. Without one, the cashier offers it. |
| **Always print** | The receipt prints straight away. |
| **No receipt unless asked** | Nothing is sent or printed unless the cashier does it. |

Whatever the setting, the cashier can always type an address into **Email
receipt to** and tap **Send**, type a phone number into **Text receipt to**
and tap **Text**, or tap **Print receipt** (or **Gift receipt**, which
leaves the prices off). Text receipts are shown only when text messages are
available for your store. Receipts print on the 80 mm layout described in
[Printed receipts](pos-operations.md#printed-receipts), through the
browser's print dialog, so any receipt printer with a system print driver
works; see [POS hardware](pos-hardware.md#receipt-printers). Tap **New sale**
to start the next one.

## Card readers

A card reader takes card payments at the counter: the customer taps,
inserts or swipes, and the reader can ask for a tip. The register works
with Stripe's smart readers, the **Stripe Reader S700** (and S710) and
the **BBPOS WisePOS E**. Card readers are shown only when they are
available for your store; when they are not, the **POS devices** card has
no card reader controls and the register has no **Card reader** button.

To add a reader:

1. On the reader, open **Settings** and choose **Generate pairing code**.
2. In the console, open **Products → Point of sale → POS devices** and choose
   **Add card reader**.
3. Enter the **registration code** the reader shows, give the reader a
   name (such as "Front counter reader") and, optionally, pick the
   **register** it belongs to. A reader left on **Any register** can be
   used from every register.
4. The first reader you add asks for the store's address — where the reader
   is used. Stripe sets the reader up for that country.

Each reader is listed with its register and an **Online** or **Offline**
status, and can be renamed, moved to another register, or removed. A
removed reader has to be registered again with a new code to be used. A
reader must be switched on and connected to the internet to take a
payment; the register warns you when the selected reader looks offline.
See [POS hardware](pos-hardware.md#card-readers) for setup notes.

:::tip Trying it in test mode
In test mode, add a reader with the code `simulated-wpe` to get Stripe's
simulated reader. While a payment waits on it, the register shows
**Simulate tap** to complete it with a test card.
:::

## Customer display

A customer display is a tablet facing your customer. It shows your store's
logo (or name) and a welcome line between sales, the basket with its total
as you ring it up, and it lets the customer choose a tip and a receipt
themselves.

Other features can use it too. At check-in, [Waivers](waivers.md#on-the-customer-display)
can open a waiver on the display for the rider to sign.

To pair one, start from either place:

- **On the register**, tap **Pair display** next to the **Register** heading.
- **In the console**, open **Products → Point of sale → POS devices** and tap
  **Pair display** beside the register the tablet belongs to. Use this when
  you are setting a tablet up away from the till.

Then:

1. Keep **Customer display** selected. You see an address and a 6-digit
   code. The code works **once** and expires in **10 minutes**.
2. On the tablet, open that address — your console address followed by
   `/kiosk/commerce/pos-display` — and enter the code. No one signs in on
   the tablet.

Once paired, the register's button reads **Display connected**. During a
sale the display shows:

- **The basket** — each line, the subtotal, any discount, the total and
  what has been paid so far. Once a tip is added it is shown on its own
  line, with the **Total with tip** under it. Amounts are in your store's
  currency.
- **Tip choices** — when tips are on and the cashier taps **Ask on
  display**: a button per percentage, an amount the customer types, or no
  tip.
- **"Tap, insert or swipe your card on the reader."** while a card reader
  payment waits.
- **Receipt choice** — when **Receipts at the register** is **Ask the
  customer**: email, text (shown only when text messages are available
  for your store), print or no receipt. When the customer asks for an
  email receipt and **Offer email sign-up on the customer display** is on
  (it is by default), an unticked **Email me news and offers** box is shown
  under the address. Only a ticked box adds them to your marketing
  audience.

After the customer answers, the display thanks them and says the cashier
will finish up. When the sale is paid and the receipt is handled, it shows
**Thank you!** for a few seconds and then returns to the welcome screen.
The email address or phone number the customer typed is not kept on the
display: it is cleared as soon as the receipt is sent. Change the welcome line with **Customer display welcome**
in the **Commerce settings** card (blank shows "Welcome").

Paired displays are listed under **Products → Point of sale → POS devices**,
beneath their register, with a **Connected** or **Not connected** status. **Sign out** there
unpairs a display, and so does removing its register; it then has to be
paired again with a new code.

## Self-service kiosk

A self-service kiosk is a tablet your customers order from themselves. They
browse your products by category, choose sizes and modifiers, review the
total with tax, and pay — or send the order to the counter. It belongs to
one register, and its orders are register sales: the same prices, tax,
automatic promotions and stock as a sale you ring up.

The kiosk offers your active products except subscription-only products, gift
cards and digital downloads, which need more than a counter can hand over.
You choose the rest: turn off **Offer on the kiosk** on a product, or clear
one of its variants, to keep it off the kiosk (see
[Offer on the kiosk](catalog.md#offer-on-the-kiosk)).

To pair one:

1. Tap **Pair display** on the register, or beside the register under
   **Products → Point of sale → POS devices**, then choose **Self-service
   kiosk**. It shows an address and a 6-digit code that works **once** and
   expires in **10 minutes**.
2. On the tablet, open that address — your console address followed by
   `/kiosk/commerce/pos-kiosk` — and enter the code. No one signs in on the
   tablet. A customer display code does not pair a kiosk, and a kiosk code
   does not pair a display.

While you pair a kiosk, the code screen also says what the kiosk still needs
to take payment, each with a link to where you fix it:

- **Stripe** — until your store's Stripe account is connected and can take
  charges, the kiosk can't take cards. **Open Payments** goes to
  **Products → Payments**.
- **A card reader on this register** — **Pay with card** uses a reader
  assigned to the kiosk's register, not one set to **Any register**.
  **Open POS devices** goes to the card readers on **Products → Point of
  sale**. With several readers on the register, choose the kiosk's from its
  staff menu once it is paired.
- **A way to pay at all** — with **Kiosk: let customers pay at the counter**
  off and no card reader ready, customers see "Payment is not set up on this
  kiosk yet". **Open Commerce settings** goes to **Admin → Plugins →
  Commerce**, where you can turn paying at the counter back on.

The kiosk keeps working for as long as the person who paired it can use
the register. If they are removed from the site or lose access to the
register, or the plan no longer includes POS, the kiosk stops taking
orders until someone pairs it again.

A customer's order goes like this:

1. **Start order**, then tap products to add them. A product with sizes,
   options or modifiers opens its choices first. Sold-out items cannot be
   added.
2. **Checkout** shows each line with the subtotal, any discount, the tax
   and the total. Prices and tax always come from your store, never from
   the tablet.
3. The customer pays:
   - **Pay with card** sends the total to the register's
     [card reader](#card-readers). It is shown only when card readers are
     available for your store and one is assigned to the kiosk's register.
     When **Ask for tips at the register** is on, the kiosk asks for the
     tip first, so the reader does not ask again.
   - **Pay at counter** sends the order to the register (see below). It is
     on by default; turn it off with **Kiosk: let customers pay at the
     counter**.
4. After a card payment the customer chooses a receipt: email, text (only
   when text messages are available for your store), print (only when the
   register has a [receipt printer](pos-hardware.md#receipt-printers)) or no receipt.
5. The kiosk shows the **order number** and returns to the start screen.

**Pay at counter orders** appear on the register under **Kiosk orders**,
oldest first, with their number and total. **Take payment** opens one in
the register's payment panel, where you take payment with any tender, or
void it.

**Starting over.** After **Kiosk: start over after (seconds idle)** without
a touch (90 by default), the kiosk asks **Still there?** and, 20 seconds
later, clears the order: an unpaid order is canceled, and the cart and any
email address or phone number the customer typed are forgotten. An order
sent to the counter is kept for the cashier. Change the start screen's line
with **Kiosk welcome** (blank shows "Order here").

**Staff unlock.** Tap **Staff** in the corner and enter your register PIN
(see [staff PINs](pos-operations.md#staff-pins)). The kiosk lists no staff names. After
the right PIN you can choose the card reader the kiosk uses, reload it, or
**Exit kiosk mode**, which unpairs it. After five wrong PINs the unlock
screen locks for 15 minutes.

Paired kiosks are listed with your customer displays under **Products →
Point of sale → POS devices**, where **Sign out** unpairs one.

Pairing from either place needs the same access as the register itself: the
**Use the point of sale** permission for the site, on a plan that includes POS. For anyone else the **POS devices** card shows why
**Pair display** is unavailable.

## Reservations

For stays (cabins, rooms, rentals):

1. Add **resources** on the Products page — nightly rate, weekend
   multiplier, minimum nights, deposit percent, and free-cancellation
   window.
2. Drop the **Reservation widget** on any page in the besigner and point
   it at the resource id. Guests pick dates, see a live quote, and pay the
   deposit (or full amount) at checkout. Every reservation is paid this
   way, so it needs Stripe connected; until it is, the **Reservations** card
   warns that guests can't reserve and links to **Payments**.
3. Manage stays from the **Reservations** card: check in, check out
   (with a folio summary if the guest charged store purchases to the
   room), walk-ins, no-shows, and cancellations.

**Guests.** The Reservation widget asks how many guests (optional), up to what
the resource **Sleeps**, or 50 when that isn't set. A walk-in takes the same
**Guests** field, and the **Reservations** card shows the count on each stay.
At the check-in window, a resource set to **One check-in per guest** under
**At check-in** gives each guest their own check-in and wristband; see
[check-in at the window](pos-operations.md#check-in-at-the-window).

To change the count after a stay is booked, choose **Guests** on the stay in
the **Reservations** card, enter the new number and **Save**. It takes 1 up to
what the resource **Sleeps**, while the stay is pending, confirmed or checked
in. Changing it needs the **Book walk-ins and change guests** permission on the
site, the same as booking a walk-in, and the change is recorded in the site's
activity with who made it.

### Several identical units

When you have several of the same thing, such as 12 RV hookups, 30 tent
sites or four matching cabins, add them as **one resource** and set
**Spots or units available** to how many there are. Each night can then
take that many stays:

- A guest can book a range of dates as long as at least one unit is free on
  **every** night of it. Which unit they get is up to you at check-in.
- The **Reservations** card shows the units left on each of the next 14
  nights under the resource, for example "3 of 12 left".
- When a stay's busiest night has three or fewer units left, the
  Reservation widget tells the guest "Only 2 left". You choose when that
  starts: in the resource's editor, **Show “Only N left” at** takes how many
  free units or fewer bring the line up (it starts at 3). Set it to 0 to
  never show it. The **Reservations** card marks the nights at or under it.
- A walk-in takes any unit that is free on every night of the stay, and is
  refused only when some night has none left.
- Blocking dates on a resource closes every unit on those dates.
- An unpaid online checkout holds its unit for 30 minutes, then gives it
  back, the same as for a single cabin.
- Two guests can't both book the last unit: the second is told those dates
  just sold out before any payment is taken.
- Two staff can't both hand out the last unit as walk-ins either, even from
  different devices: the second is told every unit is taken on at least one
  of those nights (or "Those dates are taken" for a single cabin).
- Booking a walk-in needs the **Book walk-ins and change guests** permission on
  the site, and a plan that includes reservations, the same as a guest booking
  online. A member without it is told which permission they need, so they know
  to ask an organization admin. See
  [Reservation permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#reservation-permissions).

**Sleeps** is separate: it is how many guests one unit sleeps, shown for
information. It never limits how many stays a night can take. Leave
**Spots or units available** at 1 (or empty) for a single cabin or room;
it then works exactly as before.

For example, a campground sells **RV camping with hookups** as one resource with
**Spots or units available** set to 12 and a nightly rate of $60. Dry
camping has no limit, so it is an ordinary product on the register, not a
resource.

:::info Deposits need a plan with commerce
Taking a **reservation deposit** is a sale, and it is checked against your plan
at the moment a guest tries to pay — not just when you added the widget. On a
plan without commerce the widget still renders but checkout answers
"Reservations are not enabled". Enabling the plugin is your switch; including
commerce is your plan's. See
[downgrading](/workspace-and-billing/billing-and-plans/downgrading-and-canceling#what-changes-on-a-downgrade).
:::

## Related

- [POS hardware](pos-hardware.md)
- [Commerce overview](overview.md)
- [Product catalog](catalog.md)
