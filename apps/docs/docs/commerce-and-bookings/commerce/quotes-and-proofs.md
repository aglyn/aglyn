---
sidebar_position: 3.1
title: Quotes
description: Price a customer's order before they buy, from your products and items typed for the job, with tax worked out as you go. Attach proofs to approve, and keep every revision.
---

# Quotes

A quote prices an order for one customer before they buy: the canopy with their
logo, the sign at the size they asked for, the job with its materials and labor.
You build it in the console from your products and from items you type for the
job, and Aglyn works out the totals, tax included, as you go.

Quotes are on your site's **Products** hub, on the **Orders** tab, in the
**Quotes** card under the orders list.

## What a quote holds {#what-a-quote-holds}

- **The customer.** When your workspace keeps contacts, find someone by name,
  email or phone; or type their name, company, email and phone. A contact keeps the
  quote tied to their record.
- **Items.** Any mix of:
  - **Products** from your catalog, with the option you pick and any add-ons the
    product offers. They are priced from the product, add-ons included, exactly as
    the point of sale prices them.
  - **Custom items**, typed for this job: a name, an optional description and SKU,
    a unit price and a quantity. Turn off **Ships** for work that doesn't ship, such
    as design or installation. A custom item never changes your stock.
  - **Included** items. Turn on **Included at no charge** for anything that comes
    with the order, a product or a custom item, and it is listed at no charge.
- **Discount**: an amount off, or a percent off the items.
- **Shipping**: the amount you charge to ship it. Leave it empty when nothing ships.
- **Ship to** and **Bill to** addresses.
- **Notes for the customer** and **Terms**.

Each quote also keeps whether **Customers approve the proof before they can pay**.
When it is on and the quote has a proof the customer hasn't approved, the customer's
page asks them to approve it instead of offering **Pay**, and a payment can't be
started for it. A quote with no proof is never held. See
[Proof approval and paying](#approval-and-paying).

## New-quote defaults {#quote-defaults}

The **Quotes** card on the **Checkout** settings page sets what every new quote starts
with: whether customers approve the proof before they can pay. Turn the switch on or
off and choose **Save**. Each quote starts with this setting, and you can change it on
the quote.

## Make a quote {#make-a-quote}

1. On the **Orders** tab, choose **New quote** in the **Quotes** card.
2. Find the customer in your contacts, or type their details.
3. Choose **Add product** or **Add custom item** for each line, and set its
   quantity.
4. Add a discount, shipping, the addresses, notes and terms as you need them.
5. Choose **Create quote**.

The quote gets the next number from your store's order numbers and is listed as
**Quote #1042**, for example. Choose a quote in the list to open it again; change
anything and choose **Save**. A draft quote you no longer need can be deleted.

The list shows each quote's customer, total, status and when it last changed, and
sorts by any column.

## Totals and tax {#totals-and-tax}

The totals add up the items (included items count nothing), take off the
discount, then add shipping and tax. Tax follows your store's
[tax settings](overview.md#tax-settings):

- **Manual rates**: the rate for the quote's ship-to state and country, or for your
  store's address when the quote has no ship-to country. The discount comes off
  before tax, and shipping is not taxed. A product marked tax-exempt is left out.
- **A connected tax service** ([Tax services](tax-services.md)) prices the quote when
  you save it, and the quote shows its figure.
- **Stripe Tax**: the quote says **Tax is added at payment**, because Stripe works
  out the tax when the customer pays.
- **No sales tax**: no tax is added.

If your store hasn't chosen how it handles sales tax, the quote shows no tax and
says so, with a link to **Taxes**.

## Send the pay link {#pay-link}

Every quote has a pay link: an address on your own site, at `/pay-quote`, that opens
the quote for your customer with a **Pay** button. Open the quote and, under
**Pay link**, choose **Copy pay link**. The link is copied and shown, ready to paste
into an email or a text. It opens the quote as it was last saved, so save your changes
before you copy it.

The link doesn't expire. It keeps working until the customer pays or you replace it.

**Replace link** makes a new link and retires the old one. Use it when a link went to
the wrong person, or when you want only your latest message to work. The old link then
opens a page saying the quote was updated and that you sent a newer link, and shows
nothing of the quote. Send your customer the new one. A paid quote's link can't be
replaced.

## What your customer sees {#customer-page}

The pay link opens the quote inside your site's own header and footer:

- your business name, the quote number and its date;
- who it is for, and the bill-to and ship-to addresses;
- each item with its option and add-ons, description, SKU, quantity and price, and
  **Included** beside anything included at no charge;
- the discount, shipping, tax and total, or **Tax is added at payment** when Stripe
  Tax works the tax out;
- your notes and terms.

The page is private: search engines don't list it, and it never shows the customer's
email or phone number, your notes to yourself or who on your team wrote the quote.

**Download PDF** on the page saves the quote as a PDF file, so your customer can keep
it, print it or pass it on. The download works only from the quote's current link.

## Attach proofs {#proofs}

A proof shows your customer what they're getting before you make it: the canopy with
their logo on it, the sign laid out at size. Attach proofs to a saved quote, and your
customer sees them on the quote page, where they approve them or ask for changes.

1. Open the quote and find **Proofs** in the editor.
2. Choose **Add proof** and pick one or more files.

A proof can be a PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF file, up to
25 MB each, and a revision holds up to 10. Images show as pictures, and the other files
as a chip with the file's name and size. Choose a picture or a chip to download the
file.

Every file is checked before it's kept: a file whose contents aren't what its name says,
or that carries a program, isn't taken, and an SVG is stripped of anything that could
run. Proofs are kept privately with the quote. Only your team and the holder of the
quote's link can open them, and never through a public address.

To take a proof off, choose **Remove** under it. You can add and remove proofs until
your customer answers. After that, start a new revision to send different proofs.

Adding or removing a proof changes what your customer sees, so it counts as an edit:
a customer who has the page open is asked to look again before they answer or pay.

## What your customer sees of the proofs {#customer-proofs}

When the current revision has proofs, the quote page shows them under the quote: each
image as a picture and every other file as a download. Beside them are two choices:

- **Approve this proof.** Your customer types their name and chooses **Approve**. The
  quote keeps their name, the time, and the address and browser it came from, as the
  record of the approval, and moves to **Approved**.
- **Request changes.** Your customer says what should change, and can attach their own
  artwork: up to 10 files of the same kinds and size as proofs. The quote moves to
  **Changes requested**, with their comment and files.

The latest answer is the one that counts. A customer who asked for changes can still
approve, and one who approved can still ask for changes, which withdraws the approval.
The page tells them what they last said.

You're notified of every answer, in the console and by email, with the quote, the
customer, the revision and what they said. The notice opens the quote, and replying to
the email reaches your customer.

A paid quote still shows its proofs, with nothing to press. A link you replaced shows
nothing of the quote, proofs included, and takes no answer.

## Proof approval and paying {#approval-and-paying}

Whether paying waits on the approval is up to you, quote by quote, with **Customers
approve the proof before they can pay** (the [new-quote default](#quote-defaults) sets
where each quote starts):

- **On:** while the current revision has a proof your customer hasn't approved, the
  quote page shows a short line asking them to approve it in place of **Pay**, and no
  payment can be started. Approving brings **Pay** back. A new revision with new proofs
  needs its own approval.
- **Off:** **Pay** is always there. Your customer can approve or ask for changes, and
  paying never waits on it.

## Revisions {#revisions}

A quote's revision is the version your customer is looking at, starting at
**Revision 1**. When your customer asks for changes, or you want to send different
proofs, start the next one:

1. Open the quote and choose **Start revision 2** (or whichever comes next) under
   **Proofs**.
2. Confirm.

The revision you had is kept exactly as it stood: its items and totals, notes and
terms, its proofs, and every answer your customer gave it. The new revision starts with
no proofs and no answer, back at **Draft**, ready for new proofs and any changes to the
quote. Every earlier revision is listed under **Earlier revisions** in the quote, with
its status, its proofs and your customer's comments and files, read-only.

A paid quote takes no new revision. A quote that has earlier revisions can't be
deleted, because your customer saw them.

## Download a quote as a PDF {#pdf}

Open a saved quote and choose **Download PDF**. The PDF is the quote your customer
sees, set out as a document in your site's look:

- your logo, business name, address, email, phone and web address at the top, under a
  band in your site's primary color;
- **Quote #** with its number, the date it was last saved and its revision;
- the bill-to and ship-to addresses;
- each item with its option and add-ons, description, SKU, quantity, unit price and
  amount, and **Included** beside anything included at no charge;
- the discount, shipping, tax and total, or **Tax is added at payment** when Stripe
  Tax works the tax out;
- the pay link, as a button and as an address your customer can click, while the
  quote is still to be paid;
- your notes and terms.

Once the quote is paid, the PDF says **Paid** with the date, and has no pay link.

The logo and contact details come from your site's settings, and the colors from your
site's theme. A quote with more items than fit on a page runs onto the next, with the
item headings repeated and each page numbered. The PDF shows the quote as it was last
saved, so save your changes first.

The pay link is printed on the PDF only for someone who can also send quotes (see
[who can make and send quotes](#permissions)); for anyone else the PDF leaves it off.

## How your customer pays {#paying}

**Pay** charges the quote as you saved it, priced from its items, discount, shipping
and tax. Your customer pays on the page itself, or on a Stripe payment page that brings
them back to the quote afterward. Their email is filled in from the quote. When the
quote charges shipping, they're asked where it ships, starting from the quote's
ship-to. Under Stripe Tax, the tax is worked out from that address when they pay.

If you edit the quote while your customer has it open, **Pay** asks them to reload the
page first, so nobody pays for a version they haven't seen. Editing a quote, deleting
it or replacing its link also closes any payment your customer had started for it.

Paying needs a connected Stripe account and a decision about sales tax. Until your
store has both, **Pay** tells the customer to contact you.

## When a quote is paid {#paid}

A paid quote becomes an order, with the same number:

- it joins the **Orders** list on the day it was paid, and the **Channel** filter finds
  it as **Quote**;
- your customer gets a receipt, and their quote page shows **Paid** with a link to
  their order;
- the customer becomes a contact, and you're notified;
- stock goes down for your catalog products on the quote, included ones too. Custom
  items never change your stock.

The quote then can no longer be changed. If a second payment arrives for a quote that
was already paid, or a payment comes through a link you had replaced, it isn't counted
as a sale: the quote's timeline records it and you're notified, so you can refund it in
Stripe.

## Quotes are not orders until they're paid {#quotes-are-not-orders}

A quote shares your order numbers, but until it is paid it is not an order. It
stays out of the orders list, the money tiles, the analytics, exports, the shipping
tools and the customer's account page.

## Who can make and send quotes {#permissions}

Making, editing and deleting quotes, adding and removing proofs, starting a revision,
seeing earlier revisions and your customer's files, and downloading a quote's PDF, takes
the **Create and edit quotes** permission. Copying and replacing a quote's pay link takes
**Send quotes and invoices to customers**, and so does a PDF that carries the pay link. Everyone who can manage orders on the site has both to start with; a
custom role or a per-member override can grant or deny each one. See
[Order permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#order-permissions).
