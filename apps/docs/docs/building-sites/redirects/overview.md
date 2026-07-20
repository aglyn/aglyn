---
sidebar_position: 1
title: Redirects
description: Manage URL redirects with validation, loop detection, and hit metrics.
---

# Redirects

The **redirect manager** sends old or alternate URLs to the right place — essential when you
rename screens or migrate a site.

![The Redirects page in the Aglyn console, with an "Add redirect" action for exact-path rules](/img/redirects/redirects-page.png)

:::info Plan availability
**Paid**. The redirect manager is a paid feature.
:::

## Manage redirects

- Create, edit, and delete redirect rules from the **redirect manager** page.
- Rules are **validated** on save, with **chain-loop** and **screen-collision** checks so a
  redirect can't send visitors in circles or shadow a real screen.
- The published site enforces redirect rules during route resolution.

## Metrics

Each rule tracks **hit metrics** (sampled), so you can see which redirects are actually
used and prune the ones that aren't.

## Match modes (v2)

Rules match one of three ways:

- **Exact path** — the original mode; `/old-page` only.
- **Path prefix** — `/blog` catches `/blog` and everything under it
  (`/blog/post-1`), but not `/blogging`.
- **Regular expression** — anchored to the whole path, with capture
  groups substituted into the destination: pattern `/product/(\d+)` and
  destination `/products/item-$1` sends `/product/42` to
  `/products/item-42`. Invalid patterns are rejected at save and can
  never take the site down.

When several rules match, the lowest **priority** number fires first.
Use the inline **tester** at the bottom of the redirects card to paste a
path and see exactly which rule (if any) catches it — it runs the same
matcher the live site uses.

:::tip How-tos
- [Create a redirect](create-a-redirect.md)
- [Migration patterns](migration-patterns.md)
:::

## Related

- [Screens & layouts](../screens-and-layouts/overview.md)
- [Site protection & error pages](../site-protection/overview.md)
