---
sidebar_position: 3.6
title: Waivers
description: Write your waiver once. Riders sign it on their phones before they arrive, on a tablet at the window or on paper, parents sign for minors, and every signer gets a signed PDF.
---

# Waivers

**Waivers** replaces the clipboard. You write your waiver once, in your own words,
and riders and guests sign it:

- **before they arrive**, from a link or a QR code on their own phone, or from a
  **Sign waiver** element on your site;
- **at the window**, on a tablet you hand them;
- **on paper**, if they'd rather, and you record it with a photo of the page.

A parent or guardian can sign for riders under the waiver's adult age, 18 unless you
change it. Every signature keeps the exact words that were signed, and the signer gets
a signed copy as a PDF by email. Staff can find anyone's waiver by name, email or day.

Waivers come with every plan that includes selling, at no extra cost. Open them from
the site's **Waivers** tab.

:::info Who can use it
Two permissions decide who can do what in Waivers. Both are on for a site's
**admins** and **editors** and off for its **viewers**, and either can be set in a
[custom role](../../workspace-and-billing/teams-and-roles/custom-roles.md) or for one
member:

- **Manage waivers**: write, publish and retire waivers, and void a signature.
- **Collect waivers**: see who signed, sign riders in at the window and record paper
  waivers.

The permission decides, not the role: someone at the window whose role is viewer can
collect waivers once they are allowed **Collect waivers**, and an admin a custom role
denies it can't. Viewers can't see signatures otherwise, because they hold people's
dates of birth and their children's names.
:::

## Your waivers {#your-waivers}

The **Waivers** card lists every waiver on the site: its title, whether it is a
**Draft**, **Published** or **Retired**, its version, how long a signature lasts,
and when it last changed. Select a waiver to open it, or **New waiver** to write
one.

## Write a waiver

1. Open **Waivers** and select **New waiver**.
2. Give it a **Title**, like *Rider release and waiver*. Signers see it at the top.
3. Write the **Waiver text** in your own words. Use the toolbar for headings, bold
   text and lists.
4. Under **Boxes every signer must tick**, add the statements a signer must agree to
   one by one, like *I have read this waiver and I understand it.* Nobody can sign
   until every box is ticked.
5. Choose the **Adult age**, from 18 to 21. Signers younger than that need a parent
   or guardian to sign for them (see [Minors](#minors)). It starts at 18.
6. Leave **A parent or guardian may sign for riders under 18** on if minors ride. The
   number in it follows the adult age you chose.
7. Choose how long **one signature is good for** (see
   [How long a signature lasts](#how-long-a-signature-lasts)).
8. Select **Save**, then **Publish**.

A waiver takes signatures only while it is **Published**. **Unpublish** pauses it, and
**Retire** stops it for good. Neither one touches the signatures already taken.

:::caution Your waiver, your words
Aglyn doesn't write or review what your waiver says. Ask your own lawyer what yours
should cover and how your state treats waivers, especially ones signed for minors.
:::

### Versions

Every time you save a change to the words, the boxes, the adult age, the minors setting
or how long it lasts, the waiver gets a new **version**. **Version history** lists each one.
Signatures already taken keep the version they signed and stay valid for the days they
cover, and their signed copy shows those words, not the new ones. If a waiver changes
while somebody is filling it in, they're asked to read the new version before they
sign.

## How long a signature lasts

- **One visit** (the default): the day it's signed, in your site's time zone. A
  rider who comes back tomorrow signs again.
- **A season**: from the day it's signed through a last day you choose.
- **A number of days**: that many days, the signing day included. Pick **A year** for
  365.

## Share it before riders arrive {#share-it-before-riders-arrive}

On the **Waivers** card, select **Share** beside a waiver:

- **Copy link** gives you a link to send in a confirmation, a text or a post.
- **Download QR code** gives you a code to print for the gate, the window or your
  ticket emails.

The link opens on your own site, at **/sign-waiver**, with your site's header and
footer: on your custom domain when one is connected, or on your site's `.aglyn.app`
address. If you connect a custom domain later, links and QR codes you already
handed out still work: your `.aglyn.app` address sends signers on to it.

The page is made for phones. The signer reads the waiver, fills in their name, email,
phone and date of birth, ticks the boxes, signs with a finger or types their name, and
agrees to sign electronically. They see a confirmation, and a signed copy goes to
their email.

The **/sign-waiver** page is there on every site with Waivers on. To design that page
yourself, make a page at that address with a **Sign waiver** element on it, and your
page is shown instead.

Links and QR codes made before share links moved to your site opened on Aglyn's own
address. They still work, and send signers on to your site.

### On your site

Add the **Sign waiver** element (under **Forms** in the Besigner) to a page. If you
publish one waiver, it opens straight to the form. If you publish several, signers
choose one from a list. The element's **Heading** setting is the line above that list.

## Sign at the window

For riders who didn't sign ahead:

1. Open **Waivers** on the tablet at the window.
2. Select **Sign at window** beside the waiver.
3. Hand the tablet over. The rider signs exactly as they would on their phone, but
   their email is optional.
4. When the screen says **Signed**, take the tablet back. **Next signer** clears the
   form for the next rider, and **Done signing** returns to the Waivers page.

The record notes which staff member handed the tablet over.

## At check-in

When you check people in at the register (see
[Check-in at the window](pos-operations.md#check-in-at-the-window)), each customer
shows their waiver for the day:

- **Waiver signed**: a signature covers today.
- **Signed for 2 of 3 riders**: a signature covers today, but for fewer people than
  the customer is checking in. Have the rest sign.
- **Waiver needed** or **Waiver not on file**: nobody has signed for today yet.

Select **Sign waiver** to sign right there on the register's device, the same way as
[at the window](#sign-at-the-window). The status updates when you're done. A customer
is matched to their waiver by the email they bought with, so ask riders to sign with
that address.

## Minors

Each waiver sets its own **Adult age**, from 18 to 21. It starts at 18, and every
waiver written before the setting existed reads as 18. The examples here use 18.

When **A parent or guardian may sign for riders under 18** is on, the signer can turn
on **I'm also signing for riders under 18** and add each minor's full name and date of
birth, then say how they're related to them, like *Parent* or *Legal guardian*. One
signature covers the adult and every minor on it.

The signer must be the adult age or older on the day they sign. Anyone younger can't
sign for themselves, and a "minor" who is the adult age or older is asked to sign
their own waiver. Someone whose birthday is today counts as that age today.

Changing the adult age starts a new version. Signatures already taken stay valid for
the version they signed.

## Paper waivers

Clipboards still work. To count a paper waiver like any other:

1. On the **Signatures** card, select **Record paper waiver**.
2. Choose the waiver it was printed from and the date written on it.
3. Copy the signer's name, date of birth and any minors from the page. Email and
   phone are optional; with an email, the signer is filed in your contacts.
4. Select **Take a photo of the signed page** and photograph it.
5. Select **Record waiver**.

The photo is kept privately with the record. A paper signer isn't emailed a copy,
because they didn't sign electronically.

## Find a signature

The **Signatures** card lists the newest first. To find someone:

- type a whole first or last name, the signer's or a minor's, or a full email
  address, in **Search a name or an email**;
- or pick a day in **Signed on**;
- and narrow either one to a single waiver with **Waiver**.

Select any column's header to sort the rows on screen, and use the page controls under
the list to see older ones. **Export CSV** downloads every signature that matches as a
spreadsheet.

### A signature's record

Select a row to see everything the signature holds:

- the waiver and version signed, and the days it covers;
- the signer's details and any minors;
- the signature as drawn or typed, or the photo of the paper page;
- the e-signature consent the signer agreed to;
- the audit trail: when it was signed, the address it was signed on, the IP address
  and device, who handed the tablet over, and a SHA-256 fingerprint of the exact words
  signed.

**Download PDF** gives you the signed copy: the words, every ticked box, the signer,
the minors, the signature and the audit trail.

**Void** marks a signature that shouldn't count, like a mistake or a duplicate. Say
why; the reason stays on the record and on its PDF. A voided signature no longer
counts for any day.

## Contacts

A signer who gives an email is added to your contacts, or matched to the contact you
already have for them, with the signing on their timeline. Their source reads
**Waiver signed** in your contacts list, on their record and in the contact reports.

## Privacy

Signatures are stored privately in your workspace. They're never in your media
library, and only the people with **Collect waivers** or **Manage waivers** can see
them.

## Keeping signed waivers after an erasure request {#keeping-signed-waivers}

A signed waiver is your record of what a rider agreed to. So when you
[erase a person](../../workspace-and-billing/signing-in-and-sessions.md#erasing-a-person) from your workspace,
the waivers they signed are kept, not erased:

- each one is kept for your **retention period**, then deleted, with its drawn
  signature and any photo of a paper page;
- its link to the person's contact is removed, because the contact is erased;
- on the **Signatures** card its status reads **Kept until** and the date it will be
  deleted, and its record says when the person asked.

The retention period is counted from the last day the waiver covers. For a waiver
signed for minors, it's counted from the day the youngest of them reaches the waiver's
adult age, if that's later. A waiver whose period has already run out is deleted when
the erasure runs.

To set the period:

1. Go to **Sites → your site → Admin → Plugins** and select **Waivers**.
2. On the **Waivers settings** card, set **Years to keep a signed waiver after its
   signer asks to be erased**, from 1 to 30. It starts at 7.
3. Press **Save site settings**.

To give every site in a workspace the same period, set it on the plugin's workspace
page under **Plugins**. Each site follows that period unless you change it on the
site's own page. A longer period also applies to waivers you're already keeping. A
shorter one applies to erasure requests made after the change.

:::caution Ask your lawyer
Aglyn doesn't know how long you need to keep a signed waiver. Ask your own lawyer,
especially about waivers signed for minors.
:::

## Related

- [POS & reservations](pos-and-reservations.md)
- [Running the register](pos-operations.md)
