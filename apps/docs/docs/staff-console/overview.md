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

![The Password card on a user's staff detail page, offering a reset email or a directly
set password](/img/staff-console/admin-user-password.png)

## What's there

- **Staff overview** — platform metrics, the newest organizations, purchases, and
  per-org usage; plus search. The **MRR estimate** counts only organizations with a
  live Stripe subscription — staff plan overrides, comped accounts, and canceled or
  unpaid subscriptions contribute $0, and annual plans count at their per-month
  equivalent rather than the month-to-month price. The tile shows how many
  organizations are billing and how many are comped, so a paid plan that bills
  nothing never inflates the headline.
- **[Support queue](support-queue.md)** — every organization's support tickets in one
  triage list: filter by open/closed, reply as Aglyn staff, close or reopen.
- **Plugin reviews & realm trust** — the marketplace review queue, plus a
  **Listed plugins — realm trust** table for granting or revoking
  [realm trust](../developers/plugins/guides/realm-bundles.md#granting-trust-staff)
  per version.
  Rejecting a version is a **verdict, not a kill**: it stops new installs, but a
  site already pinned to those bytes keeps running them. Where that has happened
  the review panel says so and offers **Stop this version**, the per-version kill
  switch — every site pinned to it renders a placeholder on the next load, and
  the rest of the listing's versions are untouched. **Taking the listing down**
  is the wider hammer: it stops *every* version, including the approved one
  customers are using. Restoring a listing clears only what the takedown did, so
  a version stopped separately stays stopped.
- **Organization management** — audited plan and entitlement overrides, suspension,
  and GDPR-erasure flags, per organization. The directory is listed server-side with
  the Admin SDK (so it shows *every* org, not the subset client rules would return),
  ordered by organization id, 25 per page with Previous/Next.
- **Entitlement editor** — full override editor for an organization's entitlements,
  its plan, and per-organization release flags. Every override needs a **reason**
  chosen from a fixed list (negotiated contract, support remediation, early access,
  correction, sales trial, or *other* — which requires a note). The reason and note
  are written onto the audit row beside the before/after and shown wherever that row
  is: the audit log, the organization's own page, and the acting staff account's
  trail. The log is append-only, so a reason not given at the time cannot be added
  afterwards. The reason is checked by the **server** that performs the override,
  not only by the dialog, so a request without one is refused rather than applied.
  The database now refuses a plan, entitlement or release-flag change made any
  other way, so that server is the *only* route an override can take and the
  reason cannot be skipped by going around the console.
  Changing an organization's release flags needs the **super** staff role; plan and
  entitlement changes are open to **billing** staff as well.
  **Clearing an override removes it.** Emptying a quota field, or setting a feature
  or release flag back to *Inherit*, deletes that override on save and hands the
  organization back to its plan default — one at a time, so the overrides you leave
  in place are untouched. **`0` is not empty**: a quota of zero is a real override,
  a cap of none (a comped 0% fee, an organization held to no POS registers), and it
  is kept. A quota field that cannot be read as a number of 0 or more refuses the
  save rather than being ignored.
  The override and its audit row are saved **together** — either both land or
  neither does. Read the message on a failure rather than assuming: it says
  *"nothing was written … safe to retry"* when the server refused the change, and
  says the outcome is **not known** when the request never got an answer (a dropped
  connection, a gateway error). In that second case, check the organization and the
  audit log before saving again — saving blind would record a before-state that is
  already overridden.
- **Users admin** — staff-claim management and disabling users, with gated listing
  and an **exact-email lookup** for accounts beyond the loaded pages. Staff access is
  granted to an **existing** account, so if someone isn't found, have them sign in to
  Aglyn once and then search their email again.
  Each account opens a **detail page** showing identity/auth state, staff role, every
  organization membership with roles and per-site access, and its recent audit trail.
- **Password help** — on that detail page, a **Password** card can email the account a
  reset link, or set its password directly for an account that cannot receive mail.
  Setting a password revokes the account's refresh tokens (so every device signs out)
  and emails the holder that an admin changed it. Both actions need the **super** staff
  role and are audited; the password itself is never recorded. An account with no email
  address supports neither.
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
  verification are Aglyn's own and are fully editable. Billing emails — receipts, failed
  payments, refunds — are sent by Stripe from its Dashboard and are listed read-only.
- **[Feature flags](feature-flags.md)** — release-gate console features via Remote
  Config, with percentage rollout; staff preview everything.
- **[Multi-tenant architecture](architecture-multi-tenancy.md)** — how organizations,
  membership, security rules, subdomains, and billing attribution fit together.
- **Audit archival** — a nightly cron moves audit entries past the 90-day retention
  window into a Storage compliance trail (JSON lines, month-partitioned) and reminds
  staff of GDPR erasure requests past their 7-day hold.
- **Organization suspension** — a staff toggle that serves 503s on the org's sites and shows the
  owner a banner.
- **[Sales tax return](sales-tax-return.md)** — the quarterly Texas return: pick a
  period, read the Form 01-114 figures for Texas, see every row the sweep could not
  fully read, and export the working papers for the Webfile session.
- **Audit log viewer** — a record of staff actions.

Access is gated on a **staff claim**, enforced per handler and by scoped Firestore
rules. The area doesn't advertise itself: `/admin/*` returns a plain **404** to anyone
without the claim, and the **Staff console** entry is hidden from the account menu
rather than shown-and-refused.

:::note Internal documentation
Deeper runbooks for staff operations live with the platform ops docs, not in this public
site.
:::

## Which identity holds staff

A staff claim lives on **one Firebase Auth user record**, and Aglyn has more than one
pool of them: the project-level pool, plus a separate pool for every organization
using [SAML SSO](../enterprise/sso.md). The same person can exist in two pools with
two different records, and **a claim on one is invisible to the other** — which is
why a grant can look successful while the person still gets a 404.

**Staff can be granted to any identity.** SSO is an option, never a requirement:

- an SSO identity in Aglyn's own tenant;
- an identity in the project pool, signing in with a password or Google;
- an SSO identity in a **customer organization's** tenant.

All three are valid and supported. When a grant is made, the audit row records the
**pool** alongside the uid, because a uid on its own does not identify an account when
two pools can hold the same one.

### Staff inside a customer's tenant — a property worth knowing

If a staff claim is granted to an identity that lives in a *customer's* SSO tenant,
**that customer's IdP administrator controls authentication for it.** They cannot mint
a staff claim — the claim is Aglyn's — but they control who can authenticate *as* the
identity that holds one, and they control whether it keeps existing.

This is allowed and sometimes unavoidable. Two things make it safe to live with:

- prefer granting staff to an identity in a tenant Aglyn controls, where there is a
  choice;
- treat a customer-tenant staff grant as a **reviewable** row: it is exactly what a
  staff-access review should be looking at, and the staff user list shows the tenant
  so it is not an undifferentiated email address.

### Offboarding

How a staff person is removed depends on which identity holds the grant:

1. **Revoke the staff claim** in the users admin. This is the step that always applies,
   and it targets the pool the identity actually lives in.
2. **Disable or delete the account** in whichever directory owns it — Google Workspace
   for an `@aglyn.com` identity, the customer's IdP for a customer-tenant identity, or
   Firebase Auth directly for a project-pool account.

Revoking the claim is not instant on its own: a claim change reaches a signed-in
session at its next **ID-token refresh**, which the console forces once per page load,
so a reload picks it up within about an hour at worst. When speed matters, disabling
the account and revoking its refresh tokens ends the session immediately.

## Break-glass access

**`zachary.w.gover@gmail.com` holds `super` staff in the project pool, permanently and
by design.** It is not an oversight, not a migration leftover, and should not be
"tidied up" — it is the account that still works when SSO does not. If SAML is
misconfigured, the IdP is down, or a domain rule is set wrong, this is the way back in.

It is a deliberate trade, and the cost is real: an identity outside Google Workspace
has **no enforced MFA, no central offboarding, and no admin session revocation.** The
whole mitigation sits on the Google account itself —

- strong two-factor, ideally a **passkey** or hardware key;
- a unique password, never reused anywhere;
- treated as a privileged credential, because it is one.

The rule below is written so it can never refuse this account: the account is on an
ungoverned domain, so it falls outside the rule by construction rather than by an
exception someone has to remember to maintain.

## Requiring SSO for a company domain

An operator can require that **every identity on a given email domain authenticates
through a specific SSO tenant.** The point is narrow: an address on a company domain
that signs in with a password or a personal Google account looks like a company
identity while being governed like a personal one — outside the directory's MFA,
offboarding and revocation.

**This is a rule about a domain, not about staff.** It applies whether or not the
person is staff, and it never requires staff to use SSO. Staff on other domains are
untouched.

Two settings, both empty/off by default:

| Setting | Meaning |
| --- | --- |
| `AGLYN_SSO_REQUIRED_DOMAINS` | `domain=tenantId` pairs, e.g. `example.com=example-tenant`. Empty means no domain is governed. |
| `AGLYN_SSO_DOMAIN_ENFORCEMENT` | `on` to refuse non-compliant sign-ins. Anything else is off. |

Both must be set for anything to be refused, and only one case is ever refused: an
address on a governed domain signing in with **no SSO tenant at all**. An identity on a
governed domain that signs in through a *different* tenant is allowed and flagged for
review, not blocked.

:::info Self-hosting
These default to empty, so a self-hosted install governs nothing unless its operator
configures it — with **their** domain and **their** tenant. Aglyn's own domain is not
compiled in anywhere.
:::

Turning enforcement on is a one-way door for anyone it refuses, so before flipping it:

1. confirm SSO staff access works through a **real sign-in**, not a token inspection;
2. migrate or retire every existing identity on the governed domain that has no tenant
   — including **automation accounts**, which are easy to forget and will simply stop
   being able to sign in.

## Why am I getting a 404?

`/admin/*` returns a plain 404 with no explanation, deliberately — a stranger should
not learn the staff console exists. That makes a *genuine* staff member's failure hard
to tell apart from a broken route.

`GET /api/auth/staff-self-check`, with your own ID token, answers it. It reports the
uid, email and pool of the session you are actually signed in as, whether that token
carries the staff claim, and — if **your own address** exists in more than one pool —
which of those records holds the grant.

It only ever reports on the caller's own identity, so it discloses nothing about anyone
else and cannot be used to find out who is staff.

## Related

- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md)
- [Single sign-on (SAML)](../enterprise/sso.md)
