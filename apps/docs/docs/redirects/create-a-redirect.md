---
sidebar_position: 2
title: Create a redirect
description: Add a redirect rule and read its hit metrics.
---

# Create a redirect

Send an old or alternate URL to the right screen.

:::info Plan availability
**Paid**.
:::

## Add a rule

1. Open the **redirect manager** page.
2. Enter the **source** path (the URL to redirect) and the **destination**.
3. Save. The rule is **validated** on save, with **chain-loop** and **screen-collision**
   checks so it can't loop or shadow a real screen.

The tenant enforces redirect rules during route resolution, so the redirect takes effect on
the live site immediately.

## Read hit metrics

Each rule tracks **sampled hit metrics**. Use them to:

- Confirm a redirect is actually being used.
- Find rules with zero hits that you can safely delete.

## Related

- [Migration patterns](migration-patterns.md)
- [Redirects overview](overview.md)
