---
sidebar_position: 3.1
title: Quotes
description: Price a customer's order before they buy, from your products and items typed for the job, with tax worked out as you go. Email it with its proof and PDF, have proofs approved, and keep every revision.
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

## A Request a quote form {#a-request-a-quote-form}

Let customers ask for a quote on your site, with the product they want and their
artwork:

1. On the **Forms** page, make a form (or open one) and open it in the Besigner.
2. Add the fields you need: a name, an email, a message, a **Product and options**
   field from the element picker's **Forms** group, and a
   [File upload](../../content-and-data/forms/overview.md#file-upload) field for logos
   or artwork.
3. On the form's page, under
   [After someone sends it](../../content-and-data/forms/overview.md#after-someone-sends-it),
   turn on **This form asks for a quote**. **Email the person a confirmation** turns on
   with it.
4. Publish the form and place it on a page.

The **Product and options** field lists your store's products for the customer to pick
from, then the product's options (size, color and so on). To quote one product only,
pick it in the field's **Product** setting; the customer then picks just its options.
The field sends the product and options in words, which is what your Inbox and your
alert show, and keeps the exact product and option beside them for the quote.

The customer gets a confirmation email with a copy of their request, and their request
lands in your Inbox marked **Quote request**.

## Start a quote from a request {#start-a-quote-from-a-request}

Open a quote request in the **Inbox** and choose **Start a quote**. The quote editor
opens with:

- **the customer**: their name, email, phone and company, as the form gave them;
- **a line for the product** they picked, with its options, priced from your catalog;
- **their message** as the quote's notes, ready to edit;
- **their files**, listed under **From the request**.

Set the prices and anything else, and choose **Create quote**. The quote keeps the
request's files as the customer's files, which you can download from the quote, and
remembers which request it came from.

When you [email the quote](#send), it is sent as a reply to the confirmation your
customer got for their request, so the request, the quote and every revision after it
are [one conversation](#conversation) in their inbox. Keep the subject the same so
every inbox keeps them together.

## Start a quote from a contact {#start-a-quote-from-a-contact}

On a contact's page in the **CRM**, choose **Start a quote**. The quote editor opens
with the contact as the customer: their name, email, phone and company. Add the lines
and choose **Create quote**.

Both need **Create and edit quotes**, and starting one from a request also needs a
role that can read the site's Inbox.

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

## Email the quote {#send}

Send the quote to your customer by email, from your site, with your own message:

1. Open a saved quote and choose **Send quote** under **Email to customer**.
2. Check **To**. It starts with the customer's email from the quote; type another
   address to send it somewhere else.
3. Check **Subject**. It starts as **Quote #1042 from** your business name.
4. Type a **Message**: a few words to your customer, shown at the top of the email.
5. Choose **Send**.

The quote then shows **Sent** with the date and the address, and moves to **Sent**
in the list (unless your customer has already approved it or asked for changes,
which it keeps showing). The email shows the quote as it was last saved, so save
your changes first.

## What your customer gets {#quote-email}

One email in your site's look, from your site's name, with:

- **Your quote from** your business name as its heading, or **Your updated quote**
  when it's a new revision of a quote you already emailed (the first email you send
  for a quote, and sending the same revision again, keep **Your quote from**);
- your message;
- the quote number, its revision and its total;
- the first three proof images, each opening the quote page, and the other proof
  files by name, to see on the quote page (a WebP image is named rather than shown,
  because some inboxes can't show one);
- what to do next, and one button:
  - **Review and approve** while
    [the proof must be approved before paying](#approval-and-paying) and isn't yet;
  - otherwise **View and pay** with the total;
- the quote attached as a PDF, the same one as [Download PDF](#pdf), with the pay
  link on it.

The button opens the quote's [pay link](#pay-link). Replies go to your site's contact
email, the one your business listing shows or else your support email, and to your
own email when your site has neither. The email ends with a line saying so.

The email is the **Quote** email under **Emails**, where you can change its wording
and colors like your other site emails. It can use these tokens:

| Token | Value |
| -- | -- |
| `{{quote.number}}`, `{{quote.revision}}`, `{{quote.total}}` | The quote number, like #1042, its revision, and its total (with "before tax" when Stripe Tax adds the tax at payment) |
| `{{quote.heading}}`, `{{quote.intro}}` | The heading, and one sentence on whether this is a new quote or an updated revision |
| `{{quote.message}}` | The message you typed; empty when you typed none |
| `{{quote.proofImages}}`, `{{quote.proofFiles}}` | Up to three proof images, and the other proof files by name |
| `{{quote.nextStep}}`, `{{quote.buttonLabel}}`, `{{quote.url}}` | What to do next, the button's words, and the pay link |
| `{{quote.subject}}` | The subject you sent it under |

A quote isn't emailed to an address that bounced or reported an email as spam. The
quote says so; copy the [pay link](#pay-link) and send it another way. Your customer
asked for the quote, so it still goes to an address that unsubscribed from your site's
newsletter, as a receipt does.

## One conversation in your customer's inbox {#conversation}

Every email about a quote goes into the same conversation: the first one, sending it
again and sending a new revision. Each one is sent as a reply to the one before, and
the subject starts as the conversation's. Keep the subject the same when you send
again: many inboxes group a conversation by its subject, so a new subject can start a
new one.

## Send it again, or send a revision {#send-again}

After the first email, the button reads:

- **Send again**, for the revision you already sent. The pay link stays the same.
- **Send revision 2** (or whichever is current), once you've
  [started a new revision](#revisions). Sending it gives your customer a new pay
  link, and the link in your earlier email opens a page saying the quote was updated,
  with nothing of the old revision. If you already replaced the link yourself, it
  isn't replaced again.

A paid quote isn't sent again.

## Send the pay link {#pay-link}

Every quote has a pay link: an address on your own site, at `/pay-quote`, that opens
the quote for your customer with a **Pay** button. [The quote email](#send) carries it
for you. To send it some other way, open the quote and, under
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

Proofs, and the files your customer sends with an answer, count toward your workspace's
[storage](../../workspace-and-billing/billing-and-plans/overview.md#files-on-quotes-and-forms)
like files in the media library. Removing a proof or deleting the quote frees the space.
A proof that would go past a storage cap you set, or past a full workspace on Free, is
refused with the reason, as a media library upload would be. Your customer's files are
always taken.

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

## Send an invoice for a quote {#invoice}

**Send invoice** sits beside **Send quote** in the quote's **Email to customer**
section:

- For a **paid** quote, it sends the invoice as your customer's record: marked paid,
  with the date, and the invoice attached as a PDF.
- For an **unpaid** quote, it sends an invoice for a customer who needs one to pay,
  with a **Pay** button. The button is the quote's own [pay link](#pay-link), so it
  opens the quote, and replacing the link retires it too.

The invoice is sent in the same [conversation](#conversation) as the quote's emails,
under the conversation's subject. Once it's sent, the section says when and to whom.
An invoice for an unpaid quote that asks your customer to approve the proof can't be
sent until they approve it: send the quote so they can.

See [Send an invoice](orders-and-returns.md#send-invoice) for everything the email
says.

## Quotes are not orders until they're paid {#quotes-are-not-orders}

A quote shares your order numbers, but until it is paid it is not an order. It
stays out of the orders list, the money tiles, the analytics, exports, the shipping
tools and the customer's account page.

## Who can make and send quotes {#permissions}

Making, editing and deleting quotes, adding and removing proofs, starting a revision,
seeing earlier revisions and your customer's files, and downloading a quote's PDF, takes
the **Create and edit quotes** permission. Emailing a quote or its invoice, and copying and replacing
its pay link, takes **Send quotes and invoices to customers**, and so does a PDF that
carries the pay link. Everyone who can manage orders on the site has both to start with; a
custom role or a per-member override can grant or deny each one. See
[Order permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#order-permissions).
