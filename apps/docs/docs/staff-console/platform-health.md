---
sidebar_position: 10
title: Platform health
description: The staff health board — serving, backups, rate limiters, signup volume, email delivery and CSP violations, with what each red light means and what to do.
---

# Platform health

:::warning Aglyn staff only
This page lives at **Staff → Health** and requires a staff claim. Everything on it is
read-only; the levers it points at live on [Lockdown](lockdown.md).
:::

The platform runs a family of health probes. Each one answers a question an operator
has on a bad day, and each one used to answer it only to whoever knew the URL. This
page is where they are read.

## Three states, never two

Every probe reports one of three things, and the third is the one that matters:

| State | Meaning |
|---|---|
| **OK** | The probe answered and everything it checks is healthy. |
| **Degraded** | The probe answered and something is wrong. The health endpoints return **HTTP 503** when degraded — that is a *successful* read of a broken system, not a failed read. |
| **No answer** | The probe could not be read at all: it timed out, refused, or returned something unparseable. |

**"No answer" is never counted as healthy.** The headline at the top only says
everything is clear when *every* probe answered *and* every one is OK. A board that
reports "all systems normal" over a probe it never reached is asserting something it
did not check.

## The probes

### Serving

Whether the console and its dependencies answer at all. Degraded here means customers
are seeing errors right now. Check the failing dependency code, then the Vercel and
Firebase status pages.

### Backups & exports

Whether a restore point exists and is recent — the thing that matters on the worst day.

This check exists because it once failed silently: a backup schedule ran perfectly
while producing a backup that was `NOT_AVAILABLE`, and nothing noticed for eleven days.
It covers two independent things:

- **Google-managed backups**, shown as a state histogram (`1 READY · 2 NOT_AVAILABLE`).
  `NOT_AVAILABLE` is **not** a failure — the API defines it as "not available at this
  moment", and backups have been measured flipping out of it and back into `READY`
  days later. Read the **age of the newest READY backup** instead; that is the number
  the verdict is built on.
- **GCS exports**, a portable weekly snapshot whose retention Aglyn controls. A stale
  export age means the weekly export job stopped running.

Unlike the other probes, this one stays red until the situation is actually fixed — a
missing restore point is a *condition*, not an event.

**A check can also answer "I don't know."** When a check carries `determinate: false`
the probe could not establish anything — the upstream errored, the listing came back
partial, or no run has completed yet. That answers 200 on purpose: reporting an
unreadable answer as a failed backup is what kept this endpoint at 503 for four and a
half days with healthy backups behind it. It is bounded — nothing recent inside the
8-day budget still goes red — but if you see `determinate: false` persisting across
several probes, the check has stopped watching and that is worth chasing.

### Rate limiters

Whether any durable rate limiter fell back recently. The limiters fail soft: a
Firestore blip drops sign-in, password reset, email verification, org creation, form
submit and the public API's per-key quota to a weaker per-instance cap for as long as
it lasts. The door was wider than intended for that window.

This one is **self-clearing** — a past episode rolls out of the trailing window on its
own, because a degraded limiter window is an event rather than a condition. Several
instance-episodes means more than one server saw it, which points at Firestore rather
than at one unlucky instance.

### Signup volume

Whether organization creation is running at wave volume. The per-uid and per-IP limits
cannot see a distributed farm that holds every actor under both caps; this counts the
aggregate instead. The manual response is the **signups feature lock** on
[Lockdown](lockdown.md).

### Email delivery

Whether this deployment can actually send mail — checked without emailing a real
person.

Both the API key and the sender address must be present: with only one, every sender
silently no-ops, and invites, password resets and receipts go nowhere with no error
anywhere. The blockers are listed in the order they stop delivery.

Domain verification is **not** observable here — a sending-scoped key has no read
permission for it — so a clean report can still bounce until DNS is verified.

## CSP violations

The durable Content-Security-Policy violation counters, over a window you choose.

These exist to make one decision answerable: **can this directive be flipped from
report-only to enforcing?** A directive with zero rows across a window of real traffic
is one that can be flipped. A directive with rows is a list of what would break.

Two things to read carefully:

- **Zero rows is a finding, not an absence.** It is the evidence a flip needs — provided
  the window is long enough to have seen real traffic through it.
- **A truncated window is not evidence of anything.** If the read hit its row cap the
  page says so, and the missing rows are the oldest days. Narrow the window rather than
  concluding a directive is clean.

Unlike the health probes, this data is staff-only rather than public: the rows carry
customer site hostnames and page paths.

## Sharing-scope drift

A scoped document with no sharing scope is **invisible to every scoped read** — both
enforcement layers fail closed on it, so the data is not leaked, it is simply gone from
every list that should show it. The weekly job finds this and notifies; it never repairs.
Stamping the missing scopes is a deliberate act, and this card is where it is performed.

The two buttons drive the same route the runbook documents, and the dry-run/write
decision stays with that route.

- **Scan for drift** is always a dry run. It pages through every scoped collection and
  reports what it *would* stamp, per collection, plus any member documents whose
  `scopeTokens` projection has gone stale. Nothing is written.
- **Stamp the missing scopes** is enabled only after a scan that actually planned writes,
  and it stamps exactly what that scan reported. Run a scan again afterwards to confirm
  it now reports none.

Three things the report says that are easy to skim past:

- **"No drift" is only as wide as the pages it read.** The count is per scan, not a
  standing guarantee.
- **A truncated legacy scan makes the count a FLOOR, not the total.** The card says so
  when it happens. Treat the number as "at least this many" and scan again.
- **A bounded run stopped early.** One pass is capped at a fixed number of pages so a
  loop cannot depend on the server ever saying stop. If the card reports it stopped
  before the route said done, run the scan again to continue.

## Pending erasures {#pending-erasures}

An erasure request from a customer waits out a **7-day hold** and is then executed by the
04:00 UTC job. This card is that queue, and the only place in the console it has ever
been visible: until AGL-2165 `/api/admin/run-erasures` accepted the cron secret and
nothing else, so a browser could not reach it at all. Staff could *queue* an erasure from
an organization's detail page and then had no way to run it, to see what was pending, or
to find out why one had not gone through — short of hand-dispatching a GitHub workflow.

That gap mattered more than most missing cron surfaces, because what is being waited on
is a **statutory deadline**, and "it runs at 04:00 UTC" is not something a data-protection
request can be closed with.

Each row answers the one question worth asking:

- **Holding** — the 7-day hold has not expired. Nothing will run, and nothing should.
- **Due** — the hold has expired. The next scheduled run will take it.

**Run due erasures now** is for when a deadline will not wait for the schedule. Three
things about it:

- **It is audited with your reason**, and the route refuses a staff-triggered run
  without one. `eraseOrg` writes its own per-organization audit row either way; the
  reason on *this* row answers why the batch did not wait.
- **It is bounded.** A run takes a fixed number of organizations, because the work is
  irreversible and a bounded batch is re-runnable. If more are due, run it again.
- **The hold is re-verified by the eraser, not by this list.** A stale list cannot make
  anything delete early.

A **skipped** organization is not a retry — `eraseOrg` has already written a durable
`org.erase-failed` audit row by the time the card reports it, and the request stays
queued. Read that row before running again.

Listing is capped, and the card says so when it hits the cap. Treat the length as a
floor.

## Idempotency claims {#idempotency-claims}

Money-moving routes take a **claim** before they act and release it after, so a retry —
Stripe's redelivery, a double-clicked button, a cron that overlapped itself — finds the
claim held and does nothing rather than charging, refunding or paying out twice.

A claim that is still held long after its work should have finished is **stranded**: the
process that took it died between claiming and releasing. Nothing is corrupted, but the
operation it guards is now *blocked* — the retry that would have completed it keeps
finding the claim and backing off. That is the failure this card exists to make visible,
because from the outside it looks like nothing happening at all.

Each row carries the claim's kind, the scope and organization it was taken for, and its
age. Age is the whole signal: a claim seconds old is a request in flight, and one hours
old is a process that is not coming back. The **stranded** threshold is the card's own,
not a property of the claim.

Listing is capped, and the card says so when it hits the cap. Treat the count as a floor.

## Resolved server config {#resolved-server-config}

Every card above asks whether the platform is working. This one asks a different
question: **is production running the configuration we think it is?**

An environment variable can be set on the Vercel *project* and still not be attached to
the *deployment* serving traffic. From outside, those two look identical — the value
reads back correctly from the project API either way, and the only way to tell them
apart is diffing deployment environment key lists by hand. This card is the deployment
answering for itself, read from inside the running function.

The table has three columns, and the third is the one that matters.

- **Resolved** — what the running code actually decided. Not what is configured: what
  the resolver returned when asked.
- **Source** — `set` means somebody configured it. `code default` means nothing is
  configured and the built-in default is in force. A resolved value alone cannot tell
  these apart, and reading a default as a deliberate choice is a mistake that has been
  made here before.
- **Setting** — the variable's name, with a tooltip describing what it decides.

The chips above the table name the deployment id, the commit and the environment the
reading came from. A reading with no deployment attached to it cannot be acted on.

### When the configured text does not mean what it says

A red banner above the table means a variable is set to something that does not resolve
the way it reads. The common cause is **surrounding whitespace**: several resolvers
lowercase their input without trimming it, so `immediate ` with a trailing space matches
nothing and falls back to the default. This is invisible to every check performed from
outside — the value reads back correctly, the key is attached to the deployment, and
production quietly does the opposite of what was intended.

When the banner appears, re-set the variable with no leading or trailing spaces and
redeploy. Editing the project variable alone does not change a running deployment.

### Values are never shown

This is a configuration *report*, not an environment dump. A staff-gated environment
dump is still a credential surface, so no variable's value is ever displayed here — not
masked, not truncated, not "just the prefix".

What is shown instead:

- **Enum settings** report the resolved word (`immediate`, `boundary`, `off`).
- **Credentials** report a class only — `live`, `test`, `restricted-live`,
  `restricted-test`, `absent`, or `unrecognized` for a shape we do not know. An
  unrecognized credential is not described further.
- **Everything else** reports `set` or `not set`.

Adding a new setting to this card means giving it one of those reporters. There is
deliberately no path that renders a raw value.

## Re-checking

**Re-check now** re-runs every probe. The probes memoise their expensive work for five
minutes per instance to bound cost, so an immediate re-check may repeat a recent
reading rather than measuring again.

## Related

- [Lockdown](lockdown.md)
- [Staff console overview](overview.md)
