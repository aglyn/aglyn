---
sidebar_position: 5
title: Reusable components
description: Promote a subtree into a reusable component and insert instances across screens.
---

# Reusable components

Build something once — a card, a call-to-action, a footer block — and reuse it everywhere as
a **reusable component**.

![The site's reusable components page](/img/besigner/components-page.png)

## Promote

1. Select the element (and its children) you want to reuse.
2. **Promote** it to a reusable component and give it a name.
3. The original stays intact where it was.

## Insert instances

Insert **instances** of the component onto any screen. Each instance **grafts the source at
render time**, so editing the source updates every instance automatically — no copy-paste
drift.

## Manage

From the site dashboard you can **rename**, **demote** (turn an instance back into normal
nodes), or **delete** a reusable component.

## Used by

A component's detail page has a **Used by** card listing everything that places an
instance of it, so deleting one is not a guess. Because instances graft at render time,
deleting a component that is still in use empties it out of every page it appears on.

Three places are searched, which is everywhere the renderer expands an instance:

- the **published version** of every screen,
- the **published version** of every layout,
- and **other reusable components** — a component can be placed inside another one, so
  one used nowhere else can still be very much in use.

Unpublished drafts and templates in your library are not searched. If the check fails —
a dropped connection, say — the card says so and shows a **Try again** button. It never
reports "nothing uses this" when it could not actually look.

## Tips

- Reusable components are perfect for anything that repeats across pages — headers, CTAs,
  contact blocks.
- Demote when you need a one-off variation that shouldn't affect the shared source.

## Related

- [The Besigner](overview.md)
- [Screens & layouts](../screens-and-layouts/overview.md#reusable-components)
