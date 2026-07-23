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

![The staff organizations directory](/img/staff-console/admin-orgs.png)

![The staff audit log](/img/staff-console/admin-audit.png)

## What's there

- **Staff overview** — platform metrics, the newest organizations, purchases, and
  per-org usage; plus search.
- **Organization management** — audited plan and entitlement overrides, suspension,
  and GDPR-erasure flags, per organization.
- **Entitlement editor** — full override editor for an organization's entitlements.
- **Users admin** — staff-claim management and disabling users, with gated listing
  and an **exact-email lookup** for accounts beyond the loaded pages.
  Each account opens a **detail page** showing identity/auth state, staff role, every
  organization membership with roles and per-site access, and its recent audit trail.
- **Staff notes** — free-text support/billing context on each organization's detail
  page, visible to staff only (never in tenant-readable data) and audited.
- **Broadcast announcements** — push a product announcement or maintenance notice as
  an in-app notification to every organization's owner/admins (optionally one plan
  tier), respecting each recipient's mute preferences; audited.
- **Billing insight** — every organization's Stripe **invoice history** and default
  **payment method** (with delinquency state) render on its detail page.
- **Impersonation** — staff can open the console as a customer account (audited; a
  pinned warning banner with one-click exit shows for the entire session; staff
  accounts cannot be impersonated).
- **System emails** — the mail Aglyn itself sends (organization invites, the monthly
  usage summary, internal alerts). Each one ships with built-in copy and can be
  replaced with a designed template built in the besigner, using email-safe blocks
  only. Set the subject and preheader from the editor's **Properties** panel; merge
  tokens the email supplies are listed there, and any token left unresolved is blanked
  before sending. **Reset to default** puts the built-in copy back.
  The list is generated from the emails the product actually sends, so staff edit the
  system emails that exist — adding one is a code change. Password reset and email
  verification are sent by Firebase Auth from its own templates and are shown as
  non-editable until Aglyn takes those sends over.
- **[Feature flags](feature-flags.md)** — release-gate console features via Remote
  Config, with percentage rollout; staff preview everything.
- **[Multi-tenant architecture](architecture-multi-tenancy.md)** — how organizations,
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

- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md)
