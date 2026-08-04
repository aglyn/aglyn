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
3. The element you promoted becomes the **first instance** of the new component, so the
   document you built it in follows the component like every other one does.

On the canvas an instance shows as a named dashed placeholder rather than its content —
the source is grafted at render time, not in the editor. Open the component itself to edit
what it contains, or **Detach** an instance to turn it back into ordinary elements.

## Insert instances

Insert **instances** of the component onto any screen. Each instance **grafts the source at
render time**, so editing the source updates every instance automatically — no copy-paste
drift.

## Properties

A component doesn't have to look identical everywhere. Give it **properties** and each
place you use it can supply its own text, image or link — while everything else, the
layout and the styling, still comes from the one component.

This is what stops a hero from being rebuilt on every page. Change the font size once and
every page follows; only the words differ.

1. Open the component and choose **File ▸ Properties…**
2. **Add property** and give it a name — `headline`, say. Pick a type (text, long text,
   image, link, number, yes/no), an optional label for the Attributes panel, and a
   **default**.
3. Inside the component, use the property's token wherever the value belongs:
   `{{prop.headline}}`. The dialog shows each property's token next to its name.
4. **Save properties**, then **publish** the component — like any other change, live pages
   pick it up on publish, not on save.

Now select any instance of the component and the Attributes panel has a field per
property. Fill in what that page should say; leave one empty and the component's own
default is what renders, so a blank field can never collapse a section.

Property names use letters, numbers and underscores, and instance values are stored
against the name — renaming a property means pages that set the old one fall back to the
default, so the dialog warns you before you save.

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
