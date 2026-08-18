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
  Repeated `NOT_AVAILABLE` is the managed backups failing again.
- **GCS exports**, a portable weekly snapshot whose retention Aglyn controls. A stale
  export age means the weekly export job stopped running.

Unlike the other probes, this one stays red until the situation is actually fixed — a
missing restore point is a *condition*, not an event.

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

## Re-checking

**Re-check now** re-runs every probe. The probes memoise their expensive work for five
minutes per instance to bound cost, so an immediate re-check may repeat a recent
reading rather than measuring again.

## Related

- [Lockdown](lockdown.md)
- [Staff console overview](overview.md)
