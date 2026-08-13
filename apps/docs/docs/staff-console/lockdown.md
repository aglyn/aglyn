---
sidebar_position: 7
title: Lockdown
description: The staff panic button — disable access platform-wide or for one workspace, site, or account, with a real logout and a visitor notice.
---

# Lockdown (the panic button)

:::warning Aglyn staff only
Lockdown controls live in the staff console at **Staff → Lockdown** and require a
staff claim; locking or lifting anything requires the **super** staff role. Every
action — lock and unlock — writes an audit row.
:::

Lockdown is the control you reach for when something has gone wrong: a compromised
site, an account being abused, a billing suspension that has run its course, or a
maintenance window that needs the doors closed. One mechanism, four scopes:

| Scope | What it covers | Where the state lives |
|---|---|---|
| **Platform** | Everyone except staff | `lockdowns/platform` |
| **Workspace (org)** | The org's console access (writes), all of its sites | `orgs/{id}.suspendedAt` family |
| **Site (host)** | One published site | `hosts/{id}.suspendedAt` family |
| **Account (user)** | One person | `lockdowns/user--{uid}` + Firebase Auth `disabled` |

Precedence is **platform → org → host → user**: the widest active scope decides the
notice a person sees.

## What a lockdown does

A lockdown is enforced **server-side at the chokepoints**, not hidden in the UI:

- **Console sessions** — the session mint and the cross-subdomain exchange refuse
  locked users with HTTP **423** and clear their session cookies. User-scope locks
  also disable the Firebase account and revoke its refresh tokens, so "logged out"
  means logged out.
- **Published sites** — the tenant middleware checks every request *before* the
  page cache, so a taken-down site serves a real **503** notice (with `Retry-After`)
  immediately — cached pages are also evicted at lock time.
- **APIs** — org-scoped API routes refuse with `423 { "error": "locked", "reason": … }`,
  so an API consumer sees *suspended*, not a mystery 403.

## Reasons and the notice

Every lock carries a reason — `security`, `billing`, `maintenance`, or `manual` —
which picks the notice the locked-out person sees. An optional custom message
replaces the notice body (**it is shown to customers — keep internal rationale in
the audit note, not here**). `billing` notices point at billing settings;
`security`/`manual` notices point at support@aglyn.com; `maintenance` shows the
window when one is set.

## Maintenance windows and expiry

A lock may carry an **until** time. When it passes, the lockdown simply stops —
access restores with **no staff action and no write**. Use it for maintenance
windows; leave it empty for anything that should stay locked until a person lifts
it.

## Who keeps access: the un-panic invariant

**Staff are never locked out, by any scope, ever.** A platform-wide lockdown
leaves every verified staff session able to reach the staff console and lift it —
this is spec-enforced (a panic button that panics its own operator is worse than
none). For the same reason, a staff account cannot be user-locked: revoke its
staff claim first if it truly must go.

## Operating it

1. Open **Staff → Lockdown** (or suspend a workspace from its org detail page —
   same mechanism underneath).
2. Pick the scope and target, the reason, an optional customer-facing message,
   and an optional end time.
3. Platform locks require typing the confirmation phrase — in the UI *and* in the
   API, so no script can take the platform down with a one-field request.
4. Lift it from the same page. Lifting also evicts stale notice pages, restores
   member write access, and is audited like the lock was.

Billing locks for lapsed subscriptions are **manual by default**. The automated
30-days-past-due sweep exists but ships disabled; it is enabled by setting the
`AUTO_LOCK_BILLING_FROM` environment variable to a start month (`YYYY-MM`) — a
deliberate operator decision, never a default.
