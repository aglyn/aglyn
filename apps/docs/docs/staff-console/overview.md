---
sidebar_position: 1
title: Staff Console (internal)
description: Aglyn-staff tools for managing tenants, entitlements, users, and audits.
---

# Staff Console (internal)

:::warning Aglyn staff only
This area documents internal tools available to **Aglyn staff** with a staff claim. It's
not accessible to regular host owners.
:::

The **staff console** is where Aglyn operators manage the platform and support tenants.

## What's there

- **Staff overview** — platform metrics, a tenant activity feed, purchases, and usage;
  plus tenant search.
- **Tenant management** — audited plan and entitlement overrides.
- **Entitlement editor** — full override editor for a tenant's entitlements.
- **Users admin** — staff-claim management and disabling users, with gated listing.
- **Tenant suspension** — a staff toggle that serves 503s on suspended sites and shows the
  owner a banner.
- **Audit log viewer** — a record of staff actions.

Access is protected by scoped Firestore rules and a staff-claim script.

:::note Internal documentation
Deeper runbooks for staff operations live with the platform ops docs, not in this public
site.
:::

## Related

- [Billing & plans](../billing-and-plans/overview.md)
