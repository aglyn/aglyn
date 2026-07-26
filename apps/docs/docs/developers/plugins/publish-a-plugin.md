---
sidebar_position: 2
title: Publish a plugin
description: Ship your own plugin to the community marketplace with version pinning.
---

# Publish a plugin

:::tip
This page covers the mechanics; the complete marketplace guide — review
process, listing authoring, versioning, payouts — is the
[Publisher handbook](publishing/publisher-handbook.md).
:::


Built something reusable? Publish it to the **community marketplace** so other Aglyn users
can install it — free or paid.

:::info Plan availability
Publishing is open to developers; **paid listings** use Stripe Connect for payouts.
:::

![The staff review queue every submission passes through](/img/plugins/plugin-reviews.png)

## The publish pipeline

Plugins go through a **publish + install pipeline** with **version pinning**, so installs
are reproducible and upgrades are deliberate:

1. Package your plugin against the **manifest + sandbox bridge protocol** (see
   [Plugins overview](overview.md)).
2. Verify locally: `node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs`
   — the publish API enforces the same checks.
3. Publish a **version** to the marketplace: **Marketplace → Publish →
   "A plugin (upload a bundle)"** — upload the bundle and its
   `manifest.json`, set the listing details and price. Uploads publish
   **sandboxed**; staff review lists (and may sign) them.
4. Installers get that pinned version and choose when to **upgrade** —
   ship updates by bumping the manifest `version` and uploading again.

## Paid listings

You can list a plugin as **paid**:

- Payments run through **Stripe Connect**.
- Earnings are tracked in a publisher **ledger**.

## Your publisher profile

Published plugins appear under your **publisher profile** in the marketplace, alongside
detail pages and listing previews.

## Tips

- Bump versions intentionally — installers stay on their pinned version until they upgrade.
- Keep the manifest's declared capabilities minimal; the sandbox enforces them.

## Related

- [Plugins & marketplace](overview.md)
