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
protect. Two consequences worth knowing before a customer reports them:

- the **tenant edit bar** stops appearing on published sites for the locked
  workspace. That is intended — the bar leads to an editor whose saves the
  freeze denies anyway;
- the folder-sharing **preview** in the media library refuses along with the
  cascade it previews.

Both are recorded decisions rather than oversights. If you find another
operation that only reads and still 423s during a window, it is worth filing —
that is how the declared list grows.

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
existed, plus everything except SVG that came in through the signed-upload
route (that route never holds the bytes, so it cannot hash them).

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
| `hash--{legacy}` | `contentHash: "<the contentHash value>"` | The same reach with the weaker key. For a non-SVG signed upload it is the only digest that exists |
| `asset--{scopeSegment}--{mediaId}` | `by: "asset"` plus `scopeSegment` and `mediaId` | Exactly one document in one workspace, matched on identity, so it needs no digest at all |

Three limits, each a real hole rather than a caveat:

- **The mint leg of a signed upload is not gated.** `POST /api/media/upload-url`
  hands out a signed URL before a single byte exists, so there is nothing to
  look up. The refusal lands at the finalize step instead, which deletes the
  orphaned object — nothing is registered, counted or billed — but the bytes do
  briefly reach the bucket.
- **A takedown bites *within* an ingestion path, not across them.** The
  signed-upload route's digest is a truncation of GCS's md5; the direct upload
  and replace routes' is a truncation of sha256. The same file pushed through
  the other route presents a different digest and therefore a different key.
  Where a file must be un-re-uploadable through *every* path, lock the scope.
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

**How fast it bites, and what it cannot reach.** A warm server refuses within
about 15 seconds of the write, and restores just as fast on a lift — the
refusal is never cached, precisely so a lift takes effect immediately. What
quarantine cannot recall is bytes *already* in a cache: a browser may hold an
image up to 60 seconds, and the CDN edge may hold an image up to an hour. For
an urgent takedown, quarantine stops the bleeding at the origin immediately but
is not a purge; if the file must be unreachable everywhere *now*, quarantine it
and then lock the scope as well.

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

There is still **no page listing the whole deny list**, so releasing a stale
entry means looking up a file it covers, or reading the listing from the
terminal.

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
