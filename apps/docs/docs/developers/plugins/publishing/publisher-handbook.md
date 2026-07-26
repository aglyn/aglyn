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

1. **Publisher profile** (Marketplace → Profile) — your handle and
   display name appear on every listing. Publishing is **organization-owned**:
   the listing belongs to your organization, not your personal account.
2. **Plan**: publishing requires a Pro plan.
3. **Payouts** (paid listings only): complete Stripe Connect onboarding
   from **Marketplace → Payouts**. The platform fee is 20% (30% on free
   plans).

## Where to publish from

Publishing lives at the organization level — **Marketplace → Publish**. Pick
a **source site**, then what to publish:

- **A component** — a reusable component from that site.
- **A layout** — a published layout from that site.
- **A dataset schema** — the field model of one of your organization's
  datasets. **Records are never published** — only the structure travels.
- **An email template** — a transactional email you've designed for that site
  (only emails that already have a saved design are offered).
- **This entire site** — its published screens and theme, as an installable
  template.

Dataset schemas are the one exception to the source-site picker: datasets
belong to the organization rather than to a site, so the picker is hidden and
the schema publishes from the org directly.

![Publishing from the organization Marketplace](/img/guides/marketplace-publish.png)

The per-site shortcuts still exist for convenience — the **Publish** actions
on a site's **Components** and **Layouts** pages, and **Publish as template**
on the **Setup** page — and open the same listing form.

### What installing each type does

Installing never changes a running site. What that means per type:

| Type | Where it lands | Live immediately? |
| --- | --- | --- |
| Component | The site's components | Yes, once you place it |
| Layout / Site template | The site's **Templates** library | No |
| Plugin | An org or per-site version pin | Yes |
| Dataset schema | A **new, empty** dataset in the org | Yes (it's new) |
| Email template | A **draft version** of that email | No |

Two details worth knowing before you publish one:

- A **dataset schema** installs as a brand-new dataset every time; it never
  merges into an existing one, since a schema change over existing rows would
  reinterpret live data. `reference` fields are relinked to the installing
  organization's datasets **by display name**, and any that can't be matched
  are degraded to plain text — the installer is told which ones.
- An **email template** installs as an inactive version of the same catalog
  email it was designed for. The site owner activates it in the email
  designer, so installing can't silently replace an email a site is already
  sending its customers. `emailHtml` blocks can't be published at all.

**Plugins are different**: a plugin is a code bundle, not a site artifact, so
it's published from your built bundle (below) rather than the source-site
picker.

## Publishing a version

Run the local verifier first — the publish API enforces the same checks
and rejects with the exact problem list:

```bash
node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs
```

Then upload it from the console: **Marketplace → Publish**, choose
**"A plugin (upload a bundle)"**, and pick your built
`plugin.bundle.mjs` plus its `manifest.json` (choose the file or paste
the JSON). Set the listing name, description, changelog, category, and
price, and publish. Uploads always publish **sandboxed** — a reviewer
verifies and signs a version before it can run trusted.

Each publish uploads your bundle (content-addressed by sha256 —
**immutable**; a new build is a new object), writes a version document
with your manifest and changelog, and bumps the listing's
`latestVersion`. To ship an update, bump `version` in the manifest and
upload again through the same dialog. There's a daily publish cap per
publisher.

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
buyer sees. Editable at publish time or any time after, no republish
needed: open **Edit listing** on your own listing's detail page (the
whole page becomes the editor), or use the **Edit** action on
**Marketplace → Listings**.

| Field | Guidance |
| --- | --- |
| Body (About) | The main docs: what it does, setup, what it adds, data & permissions. Rich-text editor with headings, bold/italic, links, and inline images; ≤20k chars. |
| Preview image | The hero shown on browse cards and at the top of the detail page — pick it from your media library. |
| Logo | Square; pick from the media library or paste an https URL. |
| Screenshots | Up to 6, from the media library or https URLs; the detail page shows a gallery with click-to-zoom. |
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

Browse is a catalogue — cards link to the **detail page**, which is the
only place an install happens. The buyer picks targets (**all sites**,
**selected sites**, or org-wide for plugins), confirms a dialog that
names exactly where the install lands, and the pin is written: your
exact `{version, sha256}` pinned to the site or org, the plugin enabled
for the workspace, loaded on their next visit. Uninstall removes the pin
and disables it — **data your plugin created stays**, so reinstalls
resume cleanly. Paid listings require purchase before install; you see
sales in your publisher ledger.

**Ratings and comments**: any signed-in user can comment on your
listing; star ratings are reserved for verified-email accounts in an
organization that actually installed it. The publishing organization can
never rate or comment on its own listing.

## Getting paid

One-time prices in whole USD (up to $1000). Purchases flow through the
platform's Stripe; your share (80%, or 70% on free plans) pays out via
your Connect account. The Marketplace → Sales tab tracks every sale.
