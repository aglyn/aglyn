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

A parent or guardian can sign for riders under 18. Every signature keeps the exact
words that were signed, and the signer gets a signed copy as a PDF by email. Staff
can find anyone's waiver by name, email or day.

Waivers come with every plan that includes selling, at no extra cost. Open them from
the site's **Waivers** tab.

:::info Who can use it
A site's **admins** and **editors** can use Waivers. Two permissions decide what each
person can do, and both are on for admins and editors unless a custom role turns them
off:

- **Manage waivers**: write, publish and retire waivers, and void a signature.
- **Collect waivers**: see who signed, sign riders in at the window and record paper
  waivers.

Viewers can't see signatures, because they hold people's dates of birth and their
children's names.
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
5. Leave **A parent or guardian may sign for riders under 18** on if minors ride.
6. Choose how long **one signature is good for** (see
   [How long a signature lasts](#how-long-a-signature-lasts)).
7. Select **Save**, then **Publish**.

A waiver takes signatures only while it is **Published**. **Unpublish** pauses it, and
**Retire** stops it for good. Neither one touches the signatures already taken.

:::caution Your waiver, your words
Aglyn doesn't write or review what your waiver says. Ask your own lawyer what yours
should cover and how your state treats waivers, especially ones signed for minors.
:::

### Versions

Every time you save a change to the words, the boxes, the minors setting or how long
it lasts, the waiver gets a new **version**. **Version history** lists each one.
Signatures already taken keep the version they signed, and their signed copy shows
those words, not the new ones. If a waiver changes while somebody is filling it in,
they're asked to read the new version before they sign.

## How long a signature lasts

- **One visit** (the default): the day it's signed, in your site's time zone. A
  rider who comes back tomorrow signs again.
- **A season**: from the day it's signed through a last day you choose.
- **A number of days**: that many days, the signing day included. Pick **A year** for
  365.

## Share it before riders arrive

On the **Waivers** card, select **Share** beside a waiver:

- **Copy link** gives you a link to send in a confirmation, a text or a post.
- **Download QR code** gives you a code to print for the gate, the window or your
  ticket emails.

The link opens a page made for phones. The signer reads the waiver, fills in their
name, email, phone and date of birth, ticks the boxes, signs with a finger or types
their name, and agrees to sign electronically. They see a confirmation, and a signed
copy goes to their email.

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

When **A parent or guardian may sign for riders under 18** is on, the signer can turn
on **I'm also signing for riders under 18** and add each minor's full name and date of
birth, then say how they're related to them, like *Parent* or *Legal guardian*. One
signature covers the adult and every minor on it.

The signer must be 18 or older. Anyone under 18 can't sign for themselves, and a
"minor" who is 18 or older is asked to sign their own waiver.

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
already have for them, with the signing on their timeline.

## Privacy

Signatures are stored privately in your workspace. They're never in your media
library, and only the people with **Collect waivers** or **Manage waivers** can see
them. When you erase a person from your workspace, every waiver they signed is erased
with it, including the minors they signed for.

## Related

- [POS & reservations](pos-and-reservations.md)
- [Running the register](pos-operations.md)
