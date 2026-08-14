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

## Feature scope

The beta-week abuse-response kit: kill **one capability platform-wide** while
everything else keeps serving. Feature locks live in the same `lockdowns`
collection (`feature--{key}` docs), use the same reasons/messages/expiry, the
same audited writer, and appear as a checklist on the same **Staff → Lockdown**
page.

| Feature key | What it stops | Reach for it when |
|---|---|---|
| `signups` | New account creation (all four doors — the signup form, both Google flows, and the sign-in page's new-account bounce). Accounts created *after* the lock began are refused a session; every existing account signs in untouched. | Bot registration wave, free-tier abuse storm |
| `uploads` | New media bytes (upload, signed-URL upload, replace). Browsing, organizing, restoring, and serving existing media all keep working. | Malware/abuse report in the DAM |
| `checkout` | **New** Stripe checkout sessions only — console plan upgrades and marketplace purchases. Existing subscriptions, invoices, and the pay-your-way-out path for billing-locked orgs are untouched, and the notice says explicitly that it is *not* a payment failure. | Stripe integration bug mid-charge |
| `marketplace-installs` | Installing anything from the marketplace (all artifact kinds, including re-copying an updated artifact). Everything already installed keeps working; publishing, reviews, and abuse reports stay open. | A malicious listing slips review (the per-plugin kill switch takes out one listing; this is the wider valve) |
| `ai-assist` | The AI assist endpoint. The switch works even while the feature is unconfigured — it predates the API key on purpose. | Provider incident, cost runaway |

**Composition, not ranking:** a platform lock implies every feature; a feature
lock implies nothing about the platform, workspace, site, or account scopes.

**Confirm weight:** feature locks do *not* require the type-to-confirm phrase.
The platform phrase exists because one request can take everything down; a
feature lock is one named capability with the platform still serving — the same
blast-radius class as an org or site lock, and incident response wants the
narrow lever fast.

**Staff bypass, per feature:** staff keep `uploads`, `marketplace-installs`,
and `ai-assist` through a lock — responding staff need to upload a test file,
reproduce an install, or make one AI call to verify the fix before lifting it.
`checkout` grants **no** staff bypass: a staff-created checkout session is
still a real charge, and verification belongs in Stripe test mode. `signups`
is decided by account age, not claims — there is no bypass to grant.

**Expiry** works the same as every scope: when the optional end time passes,
the feature restores itself with no staff action and no write.

**What a customer sees.** Every console surface a feature lock can refuse —
the billing upgrade buttons, every marketplace install and purchase button,
the theme and template installers, and both AI-assist doors — renders the
lock's own notice rather than a generic failure toast. So a checkout lock
reads *"Checkout is temporarily unavailable — this is not a payment failure,
and your account, subscription, and sites are unaffected"*, and an installs
lock reads *"installs are paused; everything already installed keeps
working"*. This matters for the message you type: it **replaces the body of
that notice**, so write it for the customer, not for the incident channel. An
end time is restated in the reader's own local time; without one, no return
time is promised. Genuine failures are untouched — a real error still shows a
real error.

## Operating it

1. Open **Staff → Lockdown** (or suspend a workspace from its org detail page —
   same mechanism underneath).
2. Pick the scope and target, the reason, an optional customer-facing message,
   and an optional end time.
3. Platform locks require typing the confirmation phrase — in the UI *and* in the
   API, so no script can take the platform down with a one-field request.
4. Lift it from the same page. Lifting also evicts stale notice pages, restores
   member write access, and is audited like the lock was.

### Never take a lock or a lift on trust

A click is a request. A click that misses — the page settles, a banner
collapses, the button moves — looks exactly like one that worked, and the
dangerous half is a *lift* you believe happened: a controlled 60-second action
becomes an outage nobody is watching.

So the page never claims a state it has not read back:

- Every lock and lift answers with the server's **re-read of the target**, and
  the workspace/site/account card shows that verdict — `LOCKED` or
  `NOT LOCKED` — stamped with the time it was read. It is a snapshot, not a
  live view, which is why the time is on it.
- **Check state** re-reads one target without touching it. Use it freely; it
  is available to every staff role, not just `super`.
- The verdict is discarded the moment you change the scope or the target id —
  a panel about the previous target is worse than no panel.
- The target id now **stays** after a submit, so `Unlock` is live immediately
  after a lock instead of being a disabled control.
- **Actions taken in this session** lists everything that reached the server,
  with the time. If you clicked and no new line appeared, the click did not
  register — check the state and click again.
- A write that returns but whose re-read disagrees is reported as
  `NOT CONFIRMED`, loudly. Treat it as an unresolved incident, not a success.

### What a caller is told

You cannot check a lockdown by trying it yourself. Staff bypass every scope —
that is the un-panic invariant, and it is deliberate — so your own request
succeeds no matter what is locked. Signing out does not help either: without a
credential the request is refused as unauthenticated long before the lockdown
verdict runs. The customer-visible refusal lives in a band between those two
that a staff operator has no way to stand in.

**What would this caller be told?** answers it from the other side. Describe the
caller — a user uid, a workspace id, a site id, or any combination — and the
server runs the same verdict every API route runs and shows you:

- whether that caller is refused, and under which scope and reason;
- the **exact response body** they receive, built by the same code that builds
  the real 423 — not a summary of it;
- which capabilities (signups, uploads, checkout, marketplace installs, AI
  assist) are refused for them, since a feature lock bites without touching any
  scope;
- whether the account you named is itself **staff**, in which case it bypasses
  everything and the answer says nothing about whether a lock is engaged.

Two honesty rules the panel follows, and you should read it by:

1. **It is computed, not observed.** It is what this server derives from state
   it reads at that moment. It does not prove that any route returned it, and
   other server processes converge within about 15 seconds, so a lock armed
   seconds ago may not yet be enforced everywhere.
2. **A scope you leave blank is not evaluated.** "Not refused" for a bare uid
   says nothing about that person's workspace. The panel lists exactly which
   scopes the answer covers, and a workspace or site id that matches nothing is
   reported as such rather than counted as clear.

Reading is open to every staff role — during an incident the person who needs
to answer "what is this customer actually seeing right now" is usually support,
not the `super`-role operator who armed the lock.

To confirm the refusal **on the wire** rather than in the abstract, you need a
caller who is genuinely refused. An org API key is the cheapest one: it carries
no staff claim and no uid, so `/api/v1` refuses its own holder. See
[Verifying a lockdown on the wire](#verifying-a-lockdown-on-the-wire).

### Verifying a lockdown on the wire

A read-only API key on a disposable workspace turns the whole 423 sweep into one
curl, because the customer REST API deliberately evaluates the verdict with
neither a staff claim nor a uid:

```bash
# Unlocked: 200 with the service document.
curl -i -H "Authorization: Bearer $AGLYN_DRILL_KEY" https://app.aglyn.com/api/v1

# With that workspace locked: 423 Locked, Retry-After, and the notice body.
# {"error":"locked","scope":"org","reason":"billing","title":"Account on hold",
#  "message":"…","contact":"support@aglyn.com","untilMs":1786695133044}
```

The same key proves the platform scope (lock the platform, the same call answers
`"scope":"platform"`). Feature scope needs a caller on a feature chokepoint —
`signups` grants no staff bypass, so a staff token on
`POST /api/auth/legal-acceptance` is refused under a signups lock and can be
checked without any extra credential.

### What the audit row records

Every lock and lift writes an `adminAudit` row carrying the actor, the `scope`,
the target path, and — in `before` and `after` — the `reason`, the
customer-facing `message`, and the end time as `untilMs`. Recording the end
time is the point: it is the only thing that distinguishes a deliberate
time-boxed lock from an indefinite one nobody came back to, and on a lift it
says whether a time-boxed lock was released early or a forgotten one was
cleaned up. A `null` in any of those three means the lock genuinely carried no
reason, no message, or no expiry.

Billing locks for lapsed subscriptions are **manual by default**. The automated
30-days-past-due sweep exists but ships disabled; it is enabled by setting the
`AUTO_LOCK_BILLING_FROM` environment variable to a start month (`YYYY-MM`) — a
deliberate operator decision, never a default.
