---
sidebar_position: 3
title: Migration patterns
description: Common redirect setups when you rename screens or move a site into Aglyn.
---

# Migration patterns

Redirects earn their keep during change. Here are the patterns you'll reach for most.

:::info Plan availability
**Paid**.
:::

## Renamed a screen

When you change a screen's [slug](../screens-and-layouts/overview.md#screens--routing), add a
redirect from the **old** path to the **new** one so existing links and search results keep
working.

## Consolidated pages

Merging two pages into one? Redirect the retired path to the survivor. The
**screen-collision** check keeps you from redirecting a path that's still a live screen.

## Moved a site into Aglyn

Recreate your highest-traffic old URLs as redirects to their new Aglyn screens. Use the
**hit metrics** to spot old URLs you missed — if a rule is getting traffic, people still
rely on it.

## Avoiding loops

The **chain-loop** check blocks redirects that would send visitors in circles (A→B→A). If a
save is rejected, look for an existing rule that already redirects your destination.

## Related

- [Create a redirect](create-a-redirect.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
