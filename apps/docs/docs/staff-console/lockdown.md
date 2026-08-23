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
maintenance window that needs the doors closed. One mechanism, five scopes:

| Scope | What it covers | Where the state lives |
|---|---|---|
| **Platform** | Everyone except staff | `lockdowns/platform` |
| **Workspace (org)** | The org's console access (writes), all of its sites | `orgs/{id}.suspendedAt` family |
| **Site (host)** | One published site | `hosts/{id}.suspendedAt` family |
| **Custom domain** | One attached domain name; the site keeps serving elsewhere | `lockdowns/domain--{hostname}` |
| **Account (user)** | One person | `lockdowns/user--{uid}` + Firebase Auth `disabled` |

Precedence is **platform → org → host → domain → user**: the widest active scope
decides the notice a person sees.

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

## Modes: full, or read-only {#read-only-mode}

Every lock is armed in one of two **modes**. The dropdown sits beside the reason
on the platform card and the workspace/site card.

| | **Full** (the default) | **Read-only** |
| --- | --- | --- |
| Customer sites | 503 notice, cached pages evicted | **keep serving normally** |
| Visitor forms, cart, checkout | refused | refused, with an inline "temporarily paused" |
| Console reads (sign-in, viewing) | refused | **work** |
| Console/API writes | refused | refused with 423 |
| Member sessions | revoked (`security`/`manual`) | **never revoked** |
| Staff | bypass everything | bypass everything |

**Reach for read-only whenever the reason is our own maintenance** — a schema
migration, a data repair, a suspected-corruption investigation. Those need the
writes frozen so nothing races the repair; they do not need the customer's shop
taken off the air, and taking it off the air costs them real money for our
convenience. Full lockdown is for takedowns: abuse, compromise, a workspace that
must stop existing publicly right now.

Read-only is available on the **platform**, **workspace (org)** and **site
(host)** scopes. It is **refused** on the `user` and `feature` scopes, because
neither has a milder setting to offer — a user lock's teeth are the Firebase
account disable and token revoke, and every feature key already names a single
write. The route answers 400 rather than silently arming a full lock.

Staff writes bypass read-only exactly as they bypass everything else, which is
the whole point: you perform the migration while the world keeps reading.

### What "reads keep working" does and does not cover

A request is classified by what it DOES, not by how it looks. Most reads are
`GET` and pass automatically. A handful of console operations are queries that
send their arguments in a `POST` body — where an asset or component is used, a
plugin's impact, signing a media URL, minting a presence token, signing in —
and each of those is declared a read individually, in the route, with the
reason written next to it.

Anything not declared **refuses**, deliberately: a chokepoint nobody has
audited is treated as a write, because an over-refused read costs a customer
some friction and an under-refused write costs the data the freeze exists to
protect. One consequence worth knowing before a customer reports it:

- the **tenant edit bar** stops appearing on published sites for the locked
  workspace. That is intended — the bar leads to an editor whose saves the
  freeze denies anyway.

That is a recorded decision rather than an oversight. If you find another
operation that only reads and still 423s during a window, it is worth filing —
that is how the declared list grows.

A declaration is usually per route, but it does not have to be. The media
**folder-sharing preview** — the "also apply to the 47 files in this folder and
its subfolders?" count the library quotes before a sharing change — is declared
per **request**, because it shares a route with five actions that write and with
the cascade it previews. During a read-only window that count still answers; the
cascade it precedes, and every other folder operation, still refuses. An author
therefore sees the size of the change they cannot yet make, which is the
question they were actually asking.

### How fast read-only takes hold {#read-only-timing}

The two halves converge at very different speeds, and the difference is the
opposite of what most people assume. Measured against the emulator and a real
production-mode tenant (AGL-1626 — the numbers below are observed responses,
not derived):

| | Observed |
| --- | --- |
| First visitor **write** after arming | **423 on the very first request** — 32–86 ms across four runs |
| `/api/lockdown-verdict` and the staff probe | **up to ~60 s** (32 s against a cold cache, 60 s against a warm one) |
| Customer pages | unchanged — 10 samples over 100 s, all `200` with content |

**The freeze is immediate; the view of the freeze lags.** Visitor write
chokepoints read the workspace and site records live on every request, so a
migration may start as soon as the lock is armed — there is no window in which
the console says "locked" and writes are still landing. What lags is the
verdict route the staff panel and the tenant middleware read, which is cached
for about a minute. So during the first minute the panel may still say a
workspace is unlocked while its customers' forms are already being refused.
That is the safe direction, but it will confuse you if you are watching the
panel to decide when to begin.

The same minute applies to a **full** lock's 503, plus one more effect worth
knowing: a page rendered while a full lock was in force is the 503 notice, and
it is cached like any other page. Lifting through the staff surface or
`/api/admin/lockdown` clears those pages as part of the lift. Editing the
workspace record directly in Firestore does not — the site keeps answering 503
from cache until the pages regenerate on their own.

### What read-only has been proved against {#read-only-evidence}

Read-only shipped with unit coverage at every layer and nothing observed on the
wire, which is a weak proof for this particular mode: a cached page still
serving is indistinguishable from a lock that never engaged. AGL-1626 closed
that with `npm run e2e:lockdown:readonly` — the emulator, a `next build` /
`next start` tenant, and a real refusal captured for each branch:

- **the site keeps serving** — `/home` returned `200` with its content on every
  sample across 100 seconds of an armed read-only workspace lock, with no
  rewrite to the maintenance notice;
- **a visitor form** answered `423` with `"Temporarily paused"` and *"Nothing
  you typed has been lost"*, carrying **no** support address — support belongs
  to the site owner, not to us — and **spent nothing**: no submission stored,
  no change to the month's counter;
- **the note you type stays behind the door.** The same lock's staff message
  ("Scheduled data migration") appeared in the *console* refusal and in none of
  the visitor ones, which carried only the pause copy. Whatever you write in
  that box is for the account holder; a stranger on their site never sees it;
- **the basket** answered `423` with *"Basket changes are paused… Browsing
  works as normal"*;
- **checkout** answered `423` with its own title and the promise no generic
  copy can make — *"this is not a payment problem and you have not been
  charged"* — refused **before** the handler, so no payment session is created;
- **strictness outranks width** (below) was forced rather than reasoned about;
- **expiry** restored writes with no staff action: refused while the window was
  open, accepted once it passed.

In the console, with the same lock armed:

- a **customer's edit** answered `423`, while the same customer's **usage scan**
  ("what is this asset used by") went through — the read that would otherwise
  push someone to delete on a guess;
- a **staff** account performed the identical edit successfully, which is the
  whole point of the mode;
- under a **platform** read-only lock a customer could still **sign in** (the
  mint is a read) and their first edit afterwards answered `423` naming the
  platform scope.

Re-run it after any change to the chokepoints. It needs the emulators, the e2e
seed, and **port 4500 free** — the tenant only recognizes `localhost:4500`
locally.

#### The one row that is not a wire observation: "never revoked" {#read-only-revocation-evidence}

Every other claim in the mode table above was forced on the wire. **"Member
sessions — never revoked" was not, and this is what stands behind it instead**
(AGL-1724).

It resisted the harness for a structural reason worth writing down, because the
same reason will defeat the next attempt: `lockdown-readonly-wire.mjs` arms its
locks by **writing the `suspended*` carrier directly**, not by POSTing to
`/api/admin/lockdown`. That is deliberate — it keeps the harness independent of
a running console — but revocation lives in `applyOrgLockdown`, which a direct
carrier write never reaches. A "the session still works" probe added to that
harness as it stands would pass against a revocation path that had been deleted
entirely. Forcing it for real needs the emulated console up, a super-staff
token, a minted member session cookie held across the arming, and the paired
`mode: 'full'` run to prove the probe can fail at all.

What it rests on instead is `apps/console/specs/lockdown-revocation-wiring.spec
.ts`, which drives the **real** `applyOrgLockdown` — the module the three other
lockdown specs all mock away, and which until then had no test of its own. It
pins both directions against the same reason (`security`, the reason that *does*
revoke under a full lock, so the discrimination is on the mode): read-only
revokes nothing, full revokes both members pool-aware, and neither ever revokes
a staff account on the roster. Each assertion was confirmed to fail against a
deliberately broken copy of the module.

**And the reason a surviving session is safe rather than merely intended:** the
write freeze is enforced in two places that have nothing to do with the session.
A read-only lock writes `orgSuspended: true` onto every member doc exactly as a
full lock does, and `orgNotSuspended()` in `cloud/firebase-firestore.rules`
gates every client-direct write on it — besigner saves included. Admin-SDK
writes are refused separately, at the wired chokepoints
(`lockdown-423-coverage.spec.ts`). So a member who keeps browsing under
read-only holds a **read** capability, not a write one, and revoking the session
would buy no enforcement — it would only sign the workspace out during our
maintenance window, which is the outcome the mode exists to avoid.

**The corollary, and it has bitten once.** Because that projection is written
for *both* modes, it answers "is this workspace locked at all" and cannot answer
"does this lock refuse this request". A chokepoint that consults the projection
*instead of* the verdict is therefore mode-blind, and it will refuse a read the
verdict just passed. That is what 404'd every **private media preview** in the
console under a read-only lock (AGL-1790): the route declared its read, the
verdict honoured it, and a legacy line beside the verdict refused on the
projection alone. The projection is still a fine *signal* — it is how these
routes avoid an org-doc read on the happy path — and it still refuses when it
disagrees with the workspace document, which is a stale projection rather than a
mode. It is just never the answer. If a read 423s or 404s during a window and
the mode table says it should work, this is the first shape to look for.

### A gentler lock never softens a stricter one

This is the highest-consequence rule in the feature, so it is worth stating on
its own: if a platform-wide read-only maintenance window is running and one
workspace is under a **full** security takedown, the takedown wins. The wider,
gentler lock does not readmit that workspace's visitors.

Forced on the wire (AGL-1626) with both armed at once: the verdict reported
`"mode":"full","reason":"security"` — the workspace's lock, not the platform's
— and the site answered `503` with `Retry-After`. Arming a maintenance window
across the platform can never quietly reopen a site staff has taken down.

To arm one from a terminal, add `mode` to the usual body:

```bash
curl -X POST https://app.aglyn.com/api/admin/lockdown \
  -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"lock","scope":"org","targetId":"ORG_ID",
       "mode":"read-only","reason":"maintenance",
       "untilMs":1786695133044}'
```

`mode` is optional and defaults to `full`, so every existing runbook command and
saved script keeps doing exactly what it did before.

## Standard or takedown: what happens if we cannot reach the database {#enforcement}

Every lock carries a second, independent choice, on the console as **"If Aglyn
can't reach the database"**:

| Choice | Stored as | If the lockdown record cannot be read |
| --- | --- | --- |
| **Release — standard lock** (default) | nothing is stored | The lock stops being enforced |
| **Keep holding — takedown** | `enforcement: 'takedown'` | The lock keeps being enforced |

Lockdown normally **fails open**: if Firestore is unreachable, the verdict is
"not locked". That is deliberate and stays the default — a database blip must
not take every customer site down at once.

A legal or abuse **takedown** has the opposite cost. "We kept serving it
because our database was down" answers no court order and no CSAM report. So a
takedown holds through the outage, and only a takedown does.

**Choose takedown only for a legal or abuse order** — a court order, a DMCA
takedown you have accepted, a CSAM or malware removal, a domain hijack or
dispute. Everything else is a standard lock: maintenance windows, billing
suspensions, precautionary holds, and incident response, including the
`security` ones. Getting this wrong takes sites down for a reason unrelated to
the incident that took the database out.

Three properties worth knowing before you rely on it:

1. **It is never inferred.** Neither the scope nor the reason implies the
   class — a `security` lock is a standard lock unless you say otherwise, and
   any of the six scopes can be either. A lock is fail-closed only because
   somebody chose it, and the audit row records who and when.
2. **It is not retroactive, and it is not magic.** Enforcement holds on a
   server process that has already *seen* the takedown. A process that starts
   up during the outage has never read the record, has nothing to hold, and
   fails open like everything else — so does a takedown you try to place while
   the database is already down. In practice the case this covers is the real
   one: an order placed hours or days ago, and a blip today.
3. **The expiry still wins.** A takedown with an *until* time still releases on
   schedule, even mid-outage. Classifying a lock does not make it
   un-liftable.

A takedown cannot be `read-only`, and the route refuses the combination: a
read-only lock keeps serving the content and only refuses writes, which is the
opposite of what a takedown is for.

From a terminal, add `enforcement` to the usual body:

```bash
curl -X POST https://app.aglyn.com/api/admin/lockdown \
  -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"lock","scope":"domain","targetId":"seized.example",
       "enforcement":"takedown","reason":"security",
       "message":"This domain is subject to a dispute."}'
```

`enforcement` is optional and defaults to `standard`, so every existing runbook
command and saved script keeps failing open exactly as before. A value the
server does not recognise is **rejected** rather than defaulted, in either
direction — the response echoes the class back as `verified.enforcement` so you
can confirm the one you meant is the one that landed.

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
| `signups` | New account creation (all four doors — the signup form, both Google flows, and the sign-in page's new-account bounce). Accounts created *after* the lock began are refused a session; every existing account signs in untouched. With the blocking function registered (see below) the Auth records are refused too, so nothing is created at all. | Bot registration wave, free-tier abuse storm |
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

### `signups` also refuses account CREATION — if the valve is armed

Everything else on this page is enforced by code that ships with every deploy.
`signups` is the exception, and the difference is worth understanding before
you need it.

The lock has always refused the **session mint**, the legal-acceptance
recorder, and the signup-page doors. That makes a wave's accounts unusable —
but account creation itself is client → Firebase Auth, with no Aglyn server in
front of it, so the Auth records were still being *created*: unusable, but
accumulating in the pool and against the Auth quotas.

Refusing creation needs a Firebase Auth **`beforeUserCreated` blocking
function**, which lives in `cloud/functions` and is registered in **Identity
Platform**, not in this repo. Two consequences:

- **Merging does not deploy it.** It ships with `firebase deploy --only
  functions`, and the `beforeCreate` trigger must then show up in the Identity
  Platform blocking-functions config.
- **The switch looks identical either way.** So the Lockdown page reads the
  Identity Platform config on load and states, under the `signups` row, which
  world you are in: *"Account creation is REFUSED too"*, *"Account creation is
  NOT refused"*, or *"UNKNOWN"*. **Unknown is never rendered as armed** — if
  the page cannot confirm the valve, treat the lock as sessions-only.

**It fails CLOSED.** If the function cannot read `lockdowns/feature--signups`
— Firestore unreachable, or the read exceeding its 2.5 s budget — the account
is **refused**. This is deliberately the opposite of `getFeatureLockdown`,
which fails open for signed-in traffic. The reasoning: an account created
while Firestore is unreadable cannot finish signing up anyway (the profile,
the acceptance record and the workspace all live in Firestore), so failing
open buys an orphan Auth record rather than a working signup; a brake that
releases itself under load is not a brake, and a bot wave is exactly the load
that makes reads fail; and Identity Platform already fails closed one level up
— if the function errors or times out it refuses the operation, and that is
not configurable.

**If it ever needs to be taken out of the path in a hurry:** unregister the
`beforeCreate` trigger in the Identity Platform console. No deploy, no code
change, and it is the same console you are already in.

**It never touches sign-in.** There is deliberately no `beforeUserSignedIn`
sibling — that one fires for *existing* accounts and would put every sign-in,
including the permanent break-glass account, behind this read and this
fail-closed posture. The lock stops accounts being born; it never stops one
coming home.

**All three doors, both pools.** Email/password, Google and SSO all end at
Firebase Auth account creation, and the handler reads no provider, no email
and no `tenantId` — so SSO's per-org GCIP tenant pool is refused on the same
terms as the project pool.

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

## Custom-domain scope — one name, not the site {#domain-scope}

When the problem is **the domain rather than the content** — an ownership
dispute, a hijacked or lapsed registration now pointing at us, or a trademark
complaint about the name itself — a host takedown is disproportionate. The
customer's site is fine; the *name* is the problem. This scope locks one
attached domain while the same site keeps serving on its `*.aglyn.app`
subdomain.

```bash
curl -X POST https://console.aglyn.com/api/admin/lockdown \
  -H "Authorization: Bearer $ID_TOKEN" \
  -d '{"action":"lock","scope":"domain","targetId":"acme.com",
       "reason":"security","message":"Pending registrar review."}'
```

Three things about it are worth knowing before you use it:

**It is keyed on the NAME, not on the site.** Every other narrow scope keys on
the thing it locks. This one cannot, because the incidents it exists for are
exactly the ones where the domain moves — a disputed name gets detached and
re-attached, sometimes to a different workspace. Keying on the hostname means
the lock follows the name, survives a detach and re-attach, and **can be placed
on a domain that is currently attached to nothing at all**, which is the state
a dispute is usually resolved in.

**The notice never names the address that still works.** The site is still up
on its platform subdomain, and every other scope's copy would happily be
helpful about that. Here it must not be: the person reading the notice may be
precisely the party the site is being withheld from, and *"try acme.aglyn.app
instead"* would lift the lock in one sentence. The copy also does not say whose
the name is — a dispute is exactly the case where we do not know, and a notice
is a publication.

**A platform subdomain cannot be domain-locked.** `{sub}.aglyn.app` is our own
name, and the tenant resolves that space by subdomain without ever consulting
this scope — so a lock placed there would write a document no reader looks at.
The route refuses it rather than accepting a control that silently does
nothing. To take a platform subdomain down, use the **Site (host)** scope.

**Expiry and modes** work as everywhere else. Read-only is accepted but rarely
what you want here: a name dispute is a full refusal or nothing.

## Asset quarantine — one file, not the site that serves it

When the problem is **one uploaded file** — malware in a PDF, an abusive image,
a DMCA-noticed asset — locking the host punishes a customer for one object.
Quarantine is the proportionate lever: the CDN refuses that file worldwide
while everything else in the workspace keeps serving.

It is **reversible**, and that is the whole reason it exists instead of
deletion: a false-positive scan or a successful counter-notice is undone by
lifting the quarantine, with no re-upload and no lost URL.

**Keyed by the file's content digest, not by the document.** One quarantine
covers every media document that shares the bytes — a template duplicated into
forty workspaces is forty documents and one digest — and it keeps biting if the
same file is uploaded again.

| | |
|---|---|
| **Where the state lives** | `mediaQuarantines/index` — one document holding the whole deny list |
| **Who may set or lift** | `super` staff role, same bar as a lockdown |
| **Reasons** | `malware`, `abuse`, `dmca`, `legal`, `manual` |
| **Audited** | Every set *and* lift, with reason, actor, expiry, and the message the customer sees |
| **Expiry** | Optional, same semantics as a lockdown — when it passes, delivery restores with no action and no write |

### Which digest to send {#which-digest}

A media document may carry **two** digest fields, and they are not
interchangeable. Send the strong one.

| Field on the media document | What it is | When to send it |
|---|---|---|
| `contentSha256` | The full 64-hex sha256 of the bytes, written by the routes that actually held them | **Whenever the document has one** |
| `contentHash` | A **16-hex (64-bit) truncation** of *one of two* algorithms — sha256 on the direct upload/replace routes, GCS's md5 on the signed-upload route | Only as a fallback, when there is no `contentSha256` |

Documents with no `contentSha256` are every asset uploaded before the field
existed, plus **video larger than 50 MB** that came in through the
signed-upload route. The first of those two groups is finite and
shrinking: `tools/scripts/backfill-media-content-sha256.mjs` fills it in, one
media tree per run, and its header carries the measured cost of doing so.

That second class used to be *everything except SVG* on the signed route,
because the browser PUTs straight to storage and the server never held the
bytes. Since AGL-1629 that route streams the object back through sha256 at
finalize, up to a 50 MiB ceiling — which is exactly the largest non-video cap
it accepts, so an image, a PDF, an archive or a deck can never be too big for a
strong digest. Only video can exceed it, and only past 50 MB. The bound is
deliberate: a 200 MB video is the one shape where a full read costs more than
the strengthening is worth, and it is also the shape least likely to be a
chosen-prefix collision target.

The **request** field is called `contentHash` for both — the route accepts any
8–64 character hex digest and does not care which document field you copied it
out of. So paste the value of `contentSha256` into `"contentHash"` and read the
request field name as "the digest".

**Why the distinction is worth a paragraph.** Two files can be made to share a
`contentHash`: 64 truncated bits is collision-resistant by accident rather than
by design, and the md5-derived half is the sharp end — a chosen-prefix md5
collision is an afternoon of ordinary compute, and two files sharing a full md5
share its truncation. So an entry keyed on the weak field can be aimed at a
stranger's file. `contentSha256` is one algorithm at full width and has no such
property.

**Choosing the weaker key is a missed strengthening, never a missed takedown.**
The CDN checks **every** key an asset can present — strong digest, legacy hash,
per-asset — and any single match refuses. That is deliberate: entries in force
were written under whichever field existed when staff pressed the button, and
dropping the legacy key would mean a live takedown quietly lifting itself the
first time a replace stamped a strong digest onto the document it covered. An
entry written under either field keeps biting.

### What each key covers {#quarantine-keys}

| Key | Set it with | Reach |
|---|---|---|
| `hash--{sha256}` | `contentHash: "<the contentSha256 value>"` | Every document sharing those bytes, in every workspace — at delivery **and** at ingestion wherever the server hashed the bytes itself |
| `hash--{legacy}` | `contentHash: "<the contentHash value>"` | The same reach with the weaker key. For signed-upload video over 50 MB, and for anything uploaded before the strong digest existed, it is the only one there is |
| `asset--{scopeSegment}--{mediaId}` | `by: "asset"` plus `scopeSegment` and `mediaId` | Exactly one document in one workspace, matched on identity, so it needs no digest at all |

Three limits, each a real hole rather than a caveat:

- **The mint leg of a signed upload is not gated.** `POST /api/media/upload-url`
  hands out a signed URL before a single byte exists, so there is nothing to
  look up. The refusal lands at the finalize step instead, which deletes the
  orphaned object — nothing is registered, counted or billed — but the bytes do
  briefly reach the bucket.
- **For video over 50 MB, a takedown bites *within* an ingestion path, not
  across them.** That video is the one class the signed route still keys on a
  truncation of GCS's md5, while the direct upload and replace routes key on
  sha256 — so the same clip pushed through the other route presents a different
  digest and therefore a different key. Everything under the 50 MiB digest
  ceiling now shares one sha256 across every route, so the cross-path promise
  holds for it. Where a large video must be un-re-uploadable through *every*
  path, lock the scope.
- **A composite object carries no digest at all.** GCS reports no `md5Hash` for
  one, so a very large signed upload can reach the DAM with neither field set.
  Quarantine it `by: "asset"`, and know that it is then covered **at delivery
  only** — with no digest to compare, the ingestion gate has nothing to match on
  a fresh upload. (A *replace* aimed at that document is still refused: the
  replace route checks the target document's per-asset key too.)

Use `by: "asset"` deliberately, as well, when the same bytes are legitimate
elsewhere and only *this* workspace's copy is the subject of a report.

### What each audience is told {#quarantine-audiences}

**What a fetcher sees:** a neutral `410 Gone`, byte-identical to the lockdown
refusal. It deliberately says nothing about *why* — that a takedown notice or a
malware finding exists on a specific file is not something an anonymous fetcher
has standing to learn. The owning workspace is told the reason in the console;
the internet is told the file is gone.

**What the owner sees if they upload it again:** a `403` that *does* explain
itself. Quarantine is enforced at ingestion as well as at delivery — the upload,
replace and large-file-finalize routes all consult the deny list before they
write anything — so a re-upload of quarantined bytes is refused outright rather
than accepted and then served as a 410. Nothing is stored, nothing is billed,
and the customer gets the same "this file was disabled … it has not been
deleted" notice with the support address. Replacing the bytes of a quarantined
asset is refused for the same reason: the takedown would keep biting on the new
bytes, so a "successful" replace would have produced a file that still refuses
to load.

The ingestion gate inherits every limit in [What each key
covers](#quarantine-keys) — the unmintable signed-URL leg, the within-a-route
matching, and the digest-less composite object. Delivery is the only place
that covers all three.

**Billing is untouched, on purpose.** Quarantine does not delete the object,
does not modify the media document, and does not change the storage counter.
The file still exists and still belongs to the workspace — it is *suppressed*,
not erased — so the customer's storage usage and invoice are unchanged. The
customer notice says so explicitly, because someone whose file stops loading
will otherwise assume their data was deleted.

**How fast it bites, and what it cannot reach (AGL-1615).** The console now
states this to the operator on the Disabled files page itself, from one shared
model (`mediaTakedownReachLines()`), so this section and that page cannot drift
apart. In full:

| Surface | Stopped? | Worst case |
|---|---|---|
| Our origin | yes | ~15 s — and a lift is just as fast, because the refusal is never cached |
| The raw Storage download link | yes, **immediately** | the object's token is rotated; **permanent**, see below |
| A browser holding the ordinary URL | yes | 60 s (`max-age=60`) |
| The CDN edge, for an **image** | yes | ~1 h (`s-maxage=3600`) plus one stale serve. Video, PDFs and other types are `private` since AGL-1515 and are never edge-held |
| A browser holding the content-hashed permanent URL | **no** | that form promises never to change, so nothing can expire it early, and there is no per-file purge |
| Anything already downloaded | **no** | a browser cache, a corporate proxy, a downstream CDN, a scraper, an archive snapshot |

**A takedown stops new delivery. It is not a recall.** Say that to a
complainant in those words. "Stopped within 15 seconds at origin, up to an
hour at the edge for an already-cached image" is what safe-harbour
"expeditious" contemplates, and it is *not* the same promise as "the file is
gone". Treat any public asset with real traffic as already distributed.

**The raw download link, and why it is the one irreversible part.** A media
document also carries a `url` pointing at
`firebasestorage.googleapis.com?alt=media&token=…`, served by Google, where
none of our code runs — so the deny list is not slow there, it is never
consulted. That is the delivery path for every free-tier workspace, every
private asset and every embed predating AGL-829. Quarantine therefore rotates
that object's token, which kills the published link at once. It cannot be
undone: releasing the quarantine restores CDN delivery but does **not**
resurrect that particular URL, so any page still embedding it stays broken.
The switch is on by default (a legal or malware takedown with a live public
URL is a takedown that failed) and can be turned off for a precautionary one
you expect to lift. Rotation reaches the **one object** whose document the
operator looked up — a digest key covers copies in other workspaces, and those
keep their own links until they are taken down individually.

**What was considered and rejected.** A Vercel edge purge would close the
image window, but it puts a credentialled third-party call on the takedown
path: fail hard and a Vercel outage becomes a takedown outage; fail soft and
you have a purge you cannot rely on, which is worse than none because you
believe in it. Shortening the image `s-maxage` trades a measured hit rate on
the DAM grid's hot path (AGL-1515) for a faster worst case in a rare event.
Neither reaches bytes already delivered, which is the part that actually
matters.

**Where it shows up.** A quarantined asset carries a red **Disabled** badge in
the DAM grid, for staff and for the workspace that owns it, and the badge
carries the customer notice — the reason, the reassurance that the file was not
deleted, and the support address. The internal `note` is never part of that
payload. Before this, a disabled file looked exactly like a broken one, which is
the state most support conversations about it started from.

### Operating it from the console {#disabled-files-page}

**Staff → Disabled files** is the form. Reach for it first — it removes every
transcription step the curl below still has.

1. Pick **Workspace (org)** or **Site (host)**, paste the id, paste the **media
   id**. Both halves are in the file's CDN URL: the scope segment, then the id
   after `/media/`. **Look it up.**
2. The panel shows every key that could refuse this file, which of them are
   set, the reason and internal note behind each, and the deny list's size
   against its 2000-entry cap.
3. Pick the reason, an optional customer-facing message, an optional internal
   note and an optional end time, then **Disable this file**.

Two things it does that the curl cannot, and they are the reason to prefer it:

- **It never asks you for a digest.** You name the file; the server reads the
  document and picks the strongest key it has — `contentSha256`, then the
  legacy `contentHash`, then the per-asset key. The [Which digest to
  send](#which-digest) decision is made for you and cannot be made wrong. The
  scope segment is derived the same way, so a per-asset key always matches the
  one the CDN actually looks up.
- **Release clears everything that is biting**, not just the preferred key. An
  asset can be covered by two entries at once — a legacy-keyed one set before a
  replace stamped a strong digest onto it, plus a per-asset one — and a lift
  that dropped only one would leave the red badge up and look exactly like a
  lift that failed. The page reports `NOT CONFIRMED` unless *no* key can still
  refuse the file, and logs every action that reached the server.

**Disable only this copy** is the same deliberate narrowing as `by: "asset"`:
use it when the same bytes are legitimate elsewhere and only this workspace's
copy is the subject of the report. The key that is about to be written, and
what it reaches, is on screen before the button.

Setting and lifting needs the **super** staff role, on the page and in the
route. Looking a file up does not — during an incident "is this already
disabled?" is usually a support question.

### The whole deny list {#deny-list}

Everything above is per-file: you name a file and learn what refuses it. That
is the right shape for an incident that starts with a report, and the wrong
shape for the one situation the 2000-entry cap exists for — the list is full,
the next takedown is refused with a **409**, and the remedy is "release stale
entries". You cannot release what you cannot enumerate, and the only other
route to a stale entry is knowing a media id it covers, which for a hash-keyed
entry set months ago is exactly what nobody remembers.

The second half of **Staff → Disabled files** renders the deny list as a
table. Reading it is open to every staff role; releasing from it needs
`super`, like every other write here. Three things to know before using it:

- **A row is a key, not a file.** Release from the table clears exactly that
  one entry. The file-mode release above — "clear every key that could refuse
  this file" — is correct there and wrong here: the entry may cover a document
  that has since been deleted, and a hash key covers files in workspaces the
  row knows nothing about.
- **Oldest first**, because the whole point is finding what has been sitting
  there. An entry with no set-time at all predates the field and sorts first.
- **Expired-but-unreleased rows are called out.** Enforcement stops the moment
  an entry's end time passes, with no write — so those rows refuse nothing and
  still consume the cap. They are the safest thing to clear first, and nothing
  else on the platform would ever have told you they were there.

### From a terminal {#quarantine-curl}

The page cannot do anything this cannot; it just makes the two mistakes above
unavailable. `POST /api/admin/media-quarantine` with a staff bearer token:

```bash
# Disable one file. The value is the media document's `contentSha256` —
# see "Which digest to send" above; fall back to `contentHash` only when
# the document has no `contentSha256`.
curl -X POST -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"action":"quarantine",
       "contentHash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
       "scopeSegment":"org:acme","mediaId":"m1","reason":"dmca",
       "note":"Notice #4417 — staff eyes only",
       "message":"Disabled pending review of a copyright claim."}' \
  https://app.aglyn.com/api/admin/media-quarantine

# Lift it — the SAME digest that was used to set it. A release removes the
# one key it names, so lifting a legacy-keyed entry means sending the legacy
# `contentHash`, even if the document has since gained a `contentSha256`.
curl -X POST -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"action":"release",
       "contentHash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}' \
  https://app.aglyn.com/api/admin/media-quarantine

# An asset with no digest at all (composite object, or a pre-digest upload).
curl -X POST -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"action":"quarantine","by":"asset",
       "scopeSegment":"org:acme","mediaId":"m1","reason":"malware"}' \
  https://app.aglyn.com/api/admin/media-quarantine

# What is quarantined right now (open to every staff role). `count` against
# `maxEntries` is worth reading — a full list refuses the next takedown.
curl -H "Authorization: Bearer $STAFF_TOKEN" \
  https://app.aglyn.com/api/admin/media-quarantine
```

`message` is **shown to the customer**; `note` is the internal rationale and
never leaves the audit trail. Like every lockdown write, the response carries
the server's re-read of what it wrote — if `confirmed` is `false`, the write
returned and the state still disagrees. Treat that as an unresolved incident.

### How this surface came to be {#quarantine-history}

The arc, for whoever inherits an incident and wonders why the page is shaped
the way it is:

- **AGL-1512** shipped the enforcement — take one infected file down, not the
  host that serves it — keyed on the content digest so one takedown covers
  every copy of the bytes in every workspace.
- **AGL-1613** closed the re-upload chokepoints: quarantined bytes had been
  refused at delivery but accepted back through upload, replace, and
  large-file finalize, so a takedown could be undone by uploading the file
  again.
- **AGL-1612** gave quarantine a staff surface at all — before it, the DAM
  did not show a disabled file (it looked exactly like a broken one) and no
  staff page existed. It added the red **Disabled** badge, for staff and for
  the owning workspace.
- Setting and lifting stayed **a curl with a bearer token**, which is a fine
  runbook and a bad incident tool: the operator transcribes a digest and a
  scope segment, chooses between two digest fields, and then believes the
  result. **AGL-1631** exists because this runbook named the wrong digest
  field — the reason [Which digest to send](#which-digest) is a section and
  not a footnote.
- **AGL-1687** built the form, which asks for the file rather than any key so
  the digest decision cannot be made wrong, and imported the read-back
  discipline (`NOT CONFIRMED` over claimed success) from the Lockdown page
  (AGL-1571).
- **AGL-1700** added [the deny-list table](#deny-list): the `GET` had
  returned the full listing since AGL-1512, and nothing had ever rendered it,
  so the cap-full remedy — release stale entries — required remembering a
  media id nobody remembers.

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

- whether that caller is refused **for reads, for writes, or for both**, in one
  line — under a read-only lock it says *"reads pass, writes refuse"*, which is
  the answer to the question read-only mode creates: *their site is up but they
  cannot save — is that us?*;
- under which scope and reason the refusal falls;
- the **exact response body** they receive, built by the same code that builds
  the real 423 — not a summary of it. Under a read-only lock this is what their
  **write** receives; their reads get the real data;
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

   **A customer's public site takes longer than that, and the 15 seconds is
   not the number to quote them.** A site page is gated in the tenant
   middleware, which memoizes its verdict for a further 30 seconds. Measured
   2026-08-23 (AGL-1621) **against the emulator, not production**: an `org` or
   `host` lock reaches an already-warm isolate in **~30s**, and a `platform`
   or `domain` lock in **~45s** — the two caches are in series. A lift takes
   the same time, in the same direction. A cold isolate refuses on its first
   request, so a refresh that lands on one shows the lock instantly; that is
   luck, not the bound.

   **These are FLOOR figures, and production is slower.** See
   [what has and has not been measured](#drill-provenance) before quoting any
   of them to a customer or a complainant.
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

### What has and has not been measured {#drill-provenance}

The timing figures in this document have one provenance, and it is not
production. Quoting them as if it were is the mistake that produced the
figures they replaced.

| Figure | Where it was measured | Status |
| --- | --- | --- |
| Verdict-reader TTL, 15.1s both directions | Emulator, driving the real route against a real Firestore | Measured 2026-08-23 (AGL-1621) |
| Tenant middleware memo, 30.2s lock / 30.2s lift | Emulator, against the real middleware | Measured 2026-08-23 (AGL-1621) |
| Composed ~15s console/API, ~30–45s site pages | Derived from the two above | Measured 2026-08-23 (AGL-1621) |
| **Anything on production** | — | **NOT MEASURED. No production drill has been run against the current build.** |

**Treat the emulator numbers as a floor.** Three things production adds, all
of which make it slower:

- **Edge-isolate fleet spread.** The emulator has one warm process. Vercel has
  many, each with its own 30s memo, converging independently.
- **Real Firestore round-trip time.** The emulator's is a loopback.
- **The ISR fan-out is serial**, one host at a time with a 5s timeout each
  (`revalidateHostAfterLockdown`). An `org` lock over twenty sites can take
  ~100s to *return* while already being in effect. The `host` scope pays this
  once, not per host.

The old "lock visible in ≤10s" figure was a cold isolate — which refuses on
its very first request — recorded as if it were a bound. Do not repeat that by
blending a surface: say which surface a number came from, or do not quote it.

#### Why the production drill has not been run {#production-drill-blocked}

A production drill was scoped on 2026-08-23 and **stopped before anything was
locked**, because it has no safe subject. Recorded here so the next person
does not rediscover it at the worst moment:

1. **There is no throwaway production host.** Every seeded fixture
   (`seed-e2e.mjs` and friends) is emulator-gated and refuses to run against a
   real project.
2. **The `demo` host is not a throwaway.** The tenant middleware falls back to
   it for `app.aglyn.com` **and for every Vercel preview deployment**, so
   locking it takes down far more than one site.
3. **It would deliberately turn a monitored canary red.** The render canary
   grades `demo` by loading its home page; a full lock makes that page compose
   an empty node tree, which is exactly the failure the canary exists to
   catch. Its 5-minute memo can hold the red *after* the lock lifts.
4. **A 2-minute dead-man expiry is shorter than one propagation cycle**
   (~45s each way). The lock could expire before every isolate has observed
   it engage.
5. **A dead-man expiry is not the same code path as a lift.** Expiry is
   evaluated at read time and performs **no write**, so it fires no
   revalidation fan-out. Measuring release via expiry would measure a
   different mechanism from the one an operator actually uses under pressure.

A safe production drill needs a genuinely disposable host — its own org, not
referenced by any fallback, canary or monitor — provisioned first. Until then
the emulator harnesses
(`route.drill.emulator.spec.ts`, and `LOCKDOWN_DRILL=1` for the middleware
timings) are the only repeatable source of these numbers.

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
customer-facing `message`, the `mode`, the `enforcement` class, and the end
time as `untilMs`. `mode` and `enforcement` are always stated rather than
omitted, so a row about a lock written before either field existed reads
`full` / `standard` instead of a gap you have to interpret — and a takedown is
exactly the row somebody will later have to produce as evidence. Recording the end
time is the point: it is the only thing that distinguishes a deliberate
time-boxed lock from an indefinite one nobody came back to, and on a lift it
says whether a time-boxed lock was released early or a forgotten one was
cleaned up. A `null` in any of those three means the lock genuinely carried no
reason, no message, or no expiry.

Billing locks for lapsed subscriptions are **manual by default**. The automated
30-days-past-due sweep exists but ships disabled; it is enabled by setting the
`AUTO_LOCK_BILLING_FROM` environment variable to a start month (`YYYY-MM`) — a
deliberate operator decision, never a default.

**What the sweep counts as delinquent, and why it is not just `past_due`
(AGL-1877).** A Stripe **test-mode** test-clock drill of a failed renewal
measured the timeline: the subscription retries five times, stays `past_due`
throughout, and Stripe **cancels it at 21.08 days** with
`cancellation_details.reason: 'payment_failed'`. It never becomes `unpaid`. So the
30-day grace clock outlives the `past_due`/`unpaid` statuses by nine days, and the
predicate had no reachable true branch at all until it also accepted a
**cancelled-for-non-payment** subscription. That reason is now mirrored onto
`orgs/{id}/billing/stripe` as `subscription.canceledReason`, and the sweep locks
only on the literal `'payment_failed'` — a workspace that cancelled on purpose, and
every cancellation recorded before this shipped, fail closed and are never locked.

### The LIVE dunning schedule has not been read (AGL-2430)

Every number in the paragraph above is a **test-mode** measurement. Stripe's
retry schedule, the Smart Retries flag, the after-the-final-retry behaviour and
the subscription-email toggles are **Dashboard settings held independently per
mode** (Settings → Subscriptions and emails). Test and live do not share them,
and this account has already been shown to diverge between modes on a
neighbouring setting — product tax codes were live-only until AGL-1877
reconciled them.

**What was measured in LIVE, read-only, on 2026-08-20** (account
`acct_1IzHQTDYHP4psn7h`, `GET` requests only — no Dashboard setting was
changed):

| Question | Live answer |
| -- | -- |
| Retry count / interval / terminal behaviour | **Not readable.** No API surface exposes it |
| `GET /v1/account` | No field matching `dunning｜retry｜smart_retr` anywhere in the payload |
| `/v1/billing/settings`, `/v1/subscription_settings`, `/v1/billing/dunning`, `/v1/billing/retry_settings`, `/v1/account/settings` | All `404 Unrecognized request URL` |
| `/v1/billing_portal/configurations` | `200` — but it is the customer portal, not dunning |
| Live invoices | 3, all `paid` |
| Live `subscription_cycle` invoices | 1 — `in_1U5qemDYHP4psn7hLzqzXuYc`, **amount 0, `attempt_count: 0`** |
| Live charges / failed | 1 / **0** |
| Live subscriptions | 2, both `canceled`, both `cancellation_details.reason: 'cancellation_requested'` |

So it is unreadable **twice over**: no endpoint returns the setting, and no live
renewal has ever attempted a real charge from which it could be inferred. The
one `subscription_cycle` invoice on the account is a zero-amount renewal that
never touched a card, and no live subscription has ever ended for non-payment.
AGL-1877's audit note said the account had produced *zero* `subscription_cycle`
invoices; that is now stale in letter — there is one — but correct in
substance, because a zero-amount renewal produces no dunning evidence.

**Reading it requires a human** opening the **live** Dashboard at Settings →
Subscriptions and emails and recording: the number of retries, the interval
schedule, what happens after the final retry, and whether the failed-payment,
card-expiring and receipt emails are ON. Until then:

- **Nothing in the product may state a live retry count, window length or
  terminal state as fact.** The console banner and the customer-facing billing
  docs have both been changed to describe only the shape — access continues
  while Stripe retries, and the plan stops if the retries run out. A spec in
  `apps/console/specs/billing-dunning-banner.spec.tsx` fails if a count, a
  duration or the phrase "retry window" returns to that copy.
- **`BILLING_LOCK_GRACE_DAYS = 30` stands** and is not blocked on the read. It
  is reachable under all three possible terminal settings — *cancel* (fires on
  the `canceled` + `payment_failed` branch at ~21 days, with nine days' slack),
  *mark unpaid* and *leave past_due* (both fire at day 30 on their own
  branches). No live value can make it unsafe, only more or less generous.
- **Whether Stripe emails the customer on a failed payment is also unread.**
  `system-email-catalog.ts` catalogues `stripe-payment-failed` as
  `deliveredBy: 'stripe'` precisely because the code cannot see the toggle.
  Aglyn composes no failed-payment email of its own, and the in-app
  notification it does send is suppressed entirely by a muted `billing`
  category — so if that toggle is off in live, a failed renewal has **no
  customer-reachable signal beyond the console banner**. That is the item on
  this list with a real customer consequence, and it is worth reading first.

The mode-tagged constants, and the probe evidence above, live in one place:
`apps/console/utils/stripe-dunning-schedule.ts`.
