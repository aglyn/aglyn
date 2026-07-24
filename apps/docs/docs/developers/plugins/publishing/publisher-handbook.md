---
sidebar_position: 1
title: Publisher handbook
description: Publishing to the Aglyn marketplace — from profile setup through listing authoring, review, updates, and getting paid.
---

# Publisher handbook

Everything a community publisher needs. The developer side (building the
bundle) is the [first-plugin guide](../guides/first-plugin.md); this is
the marketplace side.

![The plugin review queue](/img/plugins/plugin-reviews.png)

## Before your first publish

1. **Community profile** (Manage → Community profile) — your handle and
   display name appear on every listing. Publishing is **organization-owned**:
   the listing belongs to your organization, not your personal account.
2. **Plan**: publishing requires a Pro plan.
3. **Payouts** (paid listings only): complete Stripe Connect onboarding
   from your profile. The platform fee is 20% (30% on free plans).

## Where to publish from

Publishing lives at the organization level — **Marketplace → Publish**. Pick
a **source site**, then what to publish:

- **A component** — a reusable component from that site.
- **A layout** — a published layout from that site.
- **This entire site** — its published screens and theme, as an installable
  template.

The per-site shortcuts still exist for convenience — the **Publish** actions
on a site's **Components** and **Layouts** pages, and **Publish as template**
on the **Setup** page — and open the same listing form.

**Plugins are different**: a plugin is a code bundle, not a site artifact, so
it's published from your built bundle (below) rather than the source-site
picker.

## Publishing a version

Run the local verifier first — the publish API enforces the same checks
and rejects with the exact problem list:

```bash
node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs
```

Each publish uploads your bundle (content-addressed by sha256 —
**immutable**; a new build is a new object), writes a version document
with your manifest and changelog, and bumps the listing's
`latestVersion`. There's a daily publish cap per publisher.

## Review: what happens after you publish

New plugin listings enter the queue as **submitted** and don't appear in
public browse until staff **list** them. Reviewers see your listing
content, declared capabilities, and a fresh static-verification run.
Outcomes:

- **Listed** — publicly browsable.
- **Verified ✅** — listed plus the quality badge.
- **Rejected** — you're notified with the reason; fix and republish.
- **Realm trust** (separate, rare): staff may additionally sign a version
  so it runs in the app realm instead of the sandbox — first-party-grade
  placement for plugins that earn it.

Speed the review up: a real README, a license, sane `capabilities`
(request only the network origins you use), and working links.

## Authoring your listing

Your listing IS your storefront — it renders on the detail page every
buyer sees. Editable at publish time or any time after (the *Edit
listing* card on your own listing, no republish needed):

| Field | Guidance |
| --- | --- |
| README (markdown) | The main docs: what it does, setup, what it adds, data & permissions. Headings, lists, links, and images; ≤20k chars; https images only. |
| Logo | Square, https URL. |
| Screenshots | Up to 6, https URLs; the detail page shows a gallery. |
| Categories | Up to 3 from the fixed taxonomy. |
| License | Short label (e.g. `MIT`) — listings without one get flagged in review. |
| Homepage / repository | Public links build trust; reviewers check them. |

Be explicit about **data & permissions** in the README: what your plugin
reads/writes and every host in your manifest's network allowlist —
unverified sandbox listings show buyers a risk disclaimer, and good docs
are what overcomes it.

## Versioning & updates

- Artifacts are immutable and installs pin `{version, sha256}` — you can
  never change the code a consumer runs; ship a new version instead.
- Users update explicitly (an *Update to vX* action appears when your
  `latestVersion` passes their pin). Write a changelog every publish —
  it renders on the detail page.
- Declare `hostAbi` in your manifest; when the platform bumps its ABI
  you'll rebuild against the new template and publish a compatible
  version (installs warn, loaders refuse, until you do).

## How installs work (the buyer side)

Browse → install pins your exact version to the site (or org-wide with
*Share with org*), enables the plugin for the workspace, and it loads on
their next visit. Uninstall removes the pin and disables it — **data your
plugin created stays**, so reinstalls resume cleanly. Paid listings
require purchase before install; you see sales in your publisher ledger.

## Getting paid

One-time prices in whole USD (up to $1000). Purchases flow through the
platform's Stripe; your share (80%, or 70% on free plans) pays out via
your Connect account. The ledger on your community profile tracks every
sale.
