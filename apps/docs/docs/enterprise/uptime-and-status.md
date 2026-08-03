---
sidebar_position: 4
title: Availability & status
description: The live status page, what it does and does not show, and why there is no committed uptime percentage yet.
---

# Availability & status

## The status page

**[status.aglyn.com](/status)** checks the console and the published-site
runtime live, when you load it.

It shows whether each surface is responding **right now**.

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

Open a ticket from **Organization → Support**. Response is governed by your
[support commitment](./support-tiers.md); Enterprise is 24–48 clock hours.
