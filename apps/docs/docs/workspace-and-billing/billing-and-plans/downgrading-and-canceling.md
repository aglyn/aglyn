---
sidebar_position: 2
title: Downgrading, canceling & your data
description: What happens to your sites, files, and data when you downgrade, cancel, or delete — and how to export first.
---

# Downgrading, canceling & your data

Changing to a lower plan, canceling, or deleting are three different things with
three different effects. The short version: **downgrading and canceling never
delete anything** — only deletion does, and deletion is deliberate and
reversible within a hold window.

## Downgrading to a lower plan

A downgrade changes your **entitlements** — which features you can use and how
much — but it does **not** remove anything you've already created.

**Nothing is deleted.** Every site, file, dataset, product, and team member you
have keeps existing.

What changes:

- **You can't create *more* past the new limit.** If Pro includes 3 sites and
  you have 5, all 5 keep working — but you can't add a 6th until you're back
  under the limit or upgrade again. The same applies to datasets, team seats,
  products, POS registers, and storage.
- **Paid features you no longer have turn off at the door.** Dropping the plan
  that includes them means: the Aglyn badge reappears on your published site (if
  you had branding removal), extra languages stop serving, and members-only /
  gated content stops being delivered. The underlying content stays in your
  account — it just isn't served while the feature is inactive.
- **Your live sites stay up.** Sites over your new plan's limit keep serving
  visitors — we don't take anything offline for being over a count. You'll get a
  reminder in the console when you're over a limit so nothing is a surprise.

:::tip Export before you downgrade
You keep your data on a downgrade, but if you're tidying up it's a good moment to
export. Datasets export to CSV from **Content → Data**, and each site exports a
full backup from its **Settings → Backup**.
:::

## Canceling your subscription

- **Cancel any time.** Your subscription runs to the **end of the paid period** —
  a chip on the Billing page shows the end date, and you can **resume** before it
  hits.
- When the period ends, your organization resolves to the **Free** plan. This is
  the same as a downgrade: nothing is deleted, over-limit resources persist, and
  paid features turn off.
- A **failed payment** doesn't cancel you immediately — during Stripe's retry
  window your access continues (a past-due banner shows), and entitlements only
  drop to Free if the subscription actually lapses.

## Deleting a single site

To remove just one site (not the whole organization), open the site's
**Setup → Basic details** and use **Delete site** at the bottom. A site admin
types the site name to confirm, and it's deleted **immediately** — its screens,
media, and settings are permanently removed and its address stops resolving.
Unlike an organization deletion there's no hold, so **export a backup first**
(Setup → Backup & restore) if you might want it back. Your other sites and the
organization are unaffected.

## Deleting your organization

Deletion is separate from canceling and is the only thing that **removes your
data**. It's intentional and reversible for a short window:

1. **Request deletion** — an owner starts it from the organization settings; you
   confirm by typing the organization name. We recommend exporting first.
2. **A hold period** follows the request. During the hold nothing is deleted and
   you can **cancel the request** to fully restore.
3. **After the hold**, a final export bundle is produced and the organization —
   its sites, files, datasets, and account records — is permanently erased. This
   step is irreversible.

Deletion covers your organization's sites and their stored files and data. If you
own an organization that still has **other members**, transfer or remove them
first — a shared organization isn't deleted out from under its members.

:::info GDPR / right to erasure
You can request erasure of your personal data at any time. Deletion produces a
final data export and then permanently removes your records. Contact support if
you need an erasure completed outside the self-serve flow.
:::

## Related

- [Billing & Plans](./overview.md)
- [Teams, roles & membership](../teams-and-roles/overview.md)
