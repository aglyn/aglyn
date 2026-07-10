---
sidebar_position: 1
title: Staff Console (internal)
description: Aglyn-staff tools for managing organizations, entitlements, users, and audits.
---

# Staff Console (internal)

:::warning Aglyn staff only
This area documents internal tools available to **Aglyn staff** with a staff claim. It's
not accessible to regular host owners.
:::

The **staff console** is where Aglyn operators manage the platform and support customer organizations.

## What's there

- **Staff overview** — platform metrics, the newest organizations, purchases, and
  per-org usage; plus search.
- **Organization management** — audited plan and entitlement overrides, suspension,
  and GDPR-erasure flags, per organization.
- **Entitlement editor** — full override editor for an organization's entitlements.
- **Users admin** — staff-claim management and disabling users, with gated listing.
- **[Feature flags](./feature-flags.md)** — release-gate console features via Remote
  Config, with percentage rollout; staff preview everything.
- **[Multi-tenant architecture](./architecture-multi-tenancy.md)** — how organizations,
  membership, security rules, subdomains, and billing attribution fit together.
- **Audit archival** — a nightly cron moves audit entries past the 90-day retention
  window into a Storage compliance trail (JSON lines, month-partitioned) and reminds
  staff of GDPR erasure requests past their 7-day hold.
- **Organization suspension** — a staff toggle that serves 503s on the org's sites and shows the
  owner a banner.
- **Audit log viewer** — a record of staff actions.

Access is protected by scoped Firestore rules and a staff-claim script.

:::note Internal documentation
Deeper runbooks for staff operations live with the platform ops docs, not in this public
site.
:::

## Related

- [Billing & plans](../billing-and-plans/overview.md)
