---
sidebar_position: 2
title: Publish a plugin
description: Ship your own plugin to the community marketplace with version pinning.
---

# Publish a plugin

Built something reusable? Publish it to the **community marketplace** so other Aglyn users
can install it — free or paid.

:::info Plan availability
Publishing is open to developers; **paid listings** use Stripe Connect for payouts.
:::

## The publish pipeline

Plugins go through a **publish + install pipeline** with **version pinning**, so installs
are reproducible and upgrades are deliberate:

1. Package your plugin against the **manifest + sandbox bridge protocol** (see
   [Plugins overview](overview.md)).
2. Publish a **version** to the marketplace.
3. Installers get that pinned version and choose when to **upgrade**.

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
