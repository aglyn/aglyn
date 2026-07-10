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

:::note More detailed how-tos coming
Examples for common migration patterns are on the way.
:::

## Related

- [Screens & layouts](../screens-and-layouts/overview.md)
- [Site protection & error pages](../site-protection/overview.md)
