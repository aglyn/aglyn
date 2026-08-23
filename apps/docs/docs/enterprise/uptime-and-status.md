---
sidebar_position: 4
title: Availability & status
description: The live status page, what it does and does not show, and why there is no committed uptime percentage yet.
---

# Availability & status

## The status page

**[docs.aglyn.com/status](/status)** checks the console, the published-site
runtime, and an end-to-end page render live, from your browser, when you load
it — and again every minute while the page is open.

It shows whether each surface is responding **right now**, in one of three
words:

| Word | What it means |
| --- | --- |
| **Operational** | The service returned its own health report saying so. This is the only way a surface goes green. |
| **Degraded** | The service answered and reported a problem, or returned an error. |
| **No reading** | The check could not be completed — a blocked request, a network problem, or a reply the page cannot read. It is **not** treated as healthy, and it is not a claim that we are down. |

That third state is deliberate. From your browser a real outage and a captive
wifi portal look identical, so the page says which of the three it actually
observed rather than rounding either way.

Two limits worth knowing before you rely on it:

- **It covers the surfaces you use.** Internal subsystems — scheduled jobs,
  backups, billing, abuse controls — are monitored continuously and separately,
  and are not on the page. They can be degraded while everything on it is
  green, because none of them changes whether your site is serving.
- **It is not an independent monitor.** It is served from a different
  deployment than the services it reports on, so a console outage does not take
  it down. It is not served from a different *provider*, so an outage broad
  enough to take out the whole platform could take the page with it. If
  `/status` does not load at all, treat that as a signal.

It does **not** show uptime history or an availability percentage — nothing
stores historical samples yet, so a number there would be invented rather than
measured.

## There is no committed uptime percentage

Stated plainly because procurement asks, and because a vague answer wastes
everyone's time:

> **We have not published an uptime SLA.**

We measure availability and intend to commit to a number backed by that data —
rather than one chosen to close a deal. Until there is enough history to stand
behind, there is no percentage to quote, and we would rather say so than
publish a figure we cannot evidence.

If a committed availability figure is a hard procurement requirement today,
that is worth raising early rather than late. See
[Trust & security](/trust) for the same list from the reviewer's side.

## Where the platform runs

Published sites and the console are served from a global edge network, with
data in Google Cloud Firestore. A published page is served from cache and
regenerated in the background, so a slow origin degrades to a stale page rather
than an error.

## Reporting an outage

If something is down and [/status](/status) disagrees, tell us — the status
page checks reachability, which is not the same as everything working.

Open a ticket from **Organization → Support → Support tickets**. Response is governed by your
[support commitment](./support-tiers.md); Enterprise is 24–48 clock hours.
