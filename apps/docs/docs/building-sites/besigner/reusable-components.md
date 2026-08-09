---
sidebar_position: 5
title: Reusable components
description: Promote a subtree into a reusable component, give it properties, and insert instances across screens.
---

# Reusable components

Build something once — a card, a call-to-action, a footer block — and reuse it everywhere as
a **reusable component**.

An instance is not a copy. It **grafts the source at render time**, so editing the component
updates every page that places it. Change a font size once and the whole site follows.

:::info Plan availability
**Starter and above.** On Free, promoting an element answers *"Reusable components
require a Starter plan — see Billing to upgrade."* There is no cap on how many
components a site can have.
:::

![The site's reusable components page](/img/besigner/components-page.png)

## Promote

1. Select the element you want to reuse. The whole subtree comes with it.
2. In the **Attributes** panel, choose **Save as reusable component**.
3. Give it a name and an optional description, then **Save component**.

The element you promoted **becomes the first instance** of the new component, in place. It
keeps its position in the page and its element id, so the parent's child list, your undo
history and the current selection all stay valid.

That in-place swap is the point. If promoting left the original behind as ordinary
elements, the document that defined the component would be the one place that never
tracked it — you would edit the component later and this page alone would silently keep the
old copy.

:::note
**Save as reusable component** appears only on an element that is not already an instance
and is not locked by a shared layout. Elements a layout frames are locked on the screens
that use it — open the layout to promote from there.
:::

## Insert instances

Insert instances from **Your components** in the element drawer, on any screen, layout,
template or other component.

On the canvas an instance **renders its actual content**, not a placeholder — what you see
is what the page will render, with properties already resolved. The rendered elements are
not canvas elements, though: clicking anywhere on an instance selects **the instance**,
which is the only thing there you can select, move or delete. To change what is inside it,
open the component.

![An instance rendering its content on the besigner canvas](/img/besigner/component-instance-on-canvas.png)

## Properties

A component doesn't have to look identical everywhere. Give it **properties** and each place
you use it supplies its own text, image or link — while the layout and the styling still
come from the one component.

This is what stops a hero from being rebuilt on every page. Only the words differ.

### Declare them

1. Open the component and choose **File ▸ Properties…**
2. **Add property**. Give it a name — `headline`, say — a type, an optional label for the
   Attributes panel, and a **default**.
3. The dialog shows each property's token under its name.

![The Component properties dialog with two properties declared](/img/besigner/component-properties-dialog.png)

| Type | Field in Attributes |
| -- | -- |
| Text | Single-line text |
| Long text | Multi-line text |
| Image | Image picker |
| Link | Link / URL |
| Number | Number |
| Yes / no | Toggle |

Property names must start with a letter or underscore and contain only letters, numbers and
underscores. A dot is rejected: the Attributes panel names its field for the storage path
`propValues.<name>`, which splits on dots, so `hero.title` would address a level that does
not exist and its value would silently never reach the page.

### Use them

Inside the component, put the property's token wherever the value belongs:

```
{{prop.headline}}
```

It works in any text element and in any string attribute — the same token syntax as
`{{entry.*}}` and `{{host.*}}`.

### Save, then publish

**Saving properties is not publishing them.** A save writes the working version; live pages
read the published component.

1. **Save properties** — the dialog confirms *"Properties saved. Publish to make them
   available on live pages."*
2. **File ▸ Publish to sites** (labeled **Publish again** when the version you have open
   is already the published one) — *"Published. Every screen using this component picks
   it up within a minute — you do not need to republish them."*

Publishing the component is enough. You do not republish the pages that use it.

### Fill them in per page

Select any instance and the **Attributes** panel has one field per property.

![The Attributes panel showing one field per declared property](/img/besigner/component-instance-attributes.png)

The component's default shows as the field's **placeholder**, with the exact default
spelled out underneath. Leave a field empty and that default is what renders — so clearing
a field restores the component's own copy rather than collapsing the section to nothing.

An empty field counts as unset. `0` and **no** are real values and survive.

### What an instance can — and can't — restyle

Properties are the **only** per-instance knob for what's inside a component. Selecting
an instance and using the **Styles** tab styles the box the instance sits in — margin,
padding, background and the like all apply — but nothing inside the component can be
restyled per page. If one page needs different internals, either add a property for
the difference, edit the component itself (every page follows), or
[detach](#detach) that instance.

:::warning
Instance values are stored **against the property name**, so renaming a property orphans
every value already set against the old one and those pages fall back to the default.
Rename in place rather than deleting and re-adding.
:::

## Retrofit duplicated sections

If the same section has already been copied onto several pages, converting it is safe and
takes one pass:

1. On the page whose wording is correct, **promote** the section. It becomes an instance
   and the definition is created from it.
2. Open the component, declare a property for each part that differs between pages, and
   replace those texts with their tokens. Use the *first* page's wording as each default.
3. **Save properties**, then **publish**.
4. On every other page, insert an instance, check it renders, and only then delete the old
   section. Appending before deleting keeps the page's section order intact when the
   section is the last one.
5. Fill in that page's wording on the instance — or leave the fields empty where the copy
   was already identical.

Deleting last is what makes this reversible: at every point the page still has exactly one
copy of the section.

## Detach

**Detach from component**, on an instance, turns it back into ordinary elements with fresh
ids — the confirmation reads *"Detached — this copy no longer follows the component."*
Use it when one page needs a variation the shared source shouldn't carry.

What you get is what the page was showing. The property values set on that instance — and
the per-instance styling applied to its root — are baked into the copy as ordinary text,
images and styles, so the section looks identical before and after; it is simply editable
now. Nothing in the copy still points at a property.

Detach copies the component's **published** tree — unsaved or unpublished edits sitting
in the component's working version are not what you get.

## Nesting

A component can place instances of other components. Expansion runs to a depth of **5**,
which also bounds a component that accidentally references itself.

## Used by

A component's detail page has a **Used by** card listing everything that places an instance
of it, so deleting one is not a guess.

Three places are searched, which is everywhere the renderer expands an instance:

- the **published version** of every screen,
- the **published version** of every layout,
- and **other reusable components** — a component can be placed inside another one, so one
  used nowhere else can still be very much in use.

Unpublished drafts and templates in your library are not searched. If the check fails — a
dropped connection, say — the card says so and shows a **Try again** button. It never
reports "nothing uses this" when it could not actually look.

If a component is deleted while instances remain, those instances are left untouched rather
than emptied: a missing definition never takes a published page down.

## Manage

From the site's **Components** page you can **rename**, edit the description, open the
besigner, or **delete** a reusable component. The component's **ID** is persisted inside
every screen that places it and never changes.

You can also give a component its own **icon**, from the same picker the besigner uses for
icon elements — either in the **Edit component** dialog on the Components page, or on the
component's detail page. Every instance is then marked with it: in the hierarchy, on the
canvas badge, and in the element drawer under **Your components**. A page assembled from
promoted sections becomes readable at a glance. Components without an icon keep the
generic package glyph.

## Copy & paste vs. reusable components

| You want | Use |
| -- | -- |
| Another one right here | **Duplicate** |
| The same structure somewhere else, edited separately from then on | **[Copy & paste](copy-paste.md)** |
| One thing that updates everywhere it appears | **Reusable component** |

## Tips

- Reusable components are perfect for anything that repeats across pages — headers, CTAs,
  contact blocks.
- Give a property a default that reads well on its own. A page that sets nothing should
  still look finished.
- Detach when you need a one-off variation that shouldn't affect the shared source.

## Related

- [Copy & paste elements](copy-paste.md)
- [The Besigner](overview.md)
- [Screens & layouts](../screens-and-layouts/overview.md#reusable-components)
