---
sidebar_position: 3
title: Layouts
description: A layout is the shared frame your screens render inside — header, nav and footer in one place, nested up to five deep.
---

# Layouts

A **layout** is the shared frame a screen renders inside. It is not a page of its own and
never has a URL: it has a **slot**, and whatever screen you bind to it renders in that
slot. For the pages themselves, see [Screens](screens.md).

:::info Plan availability
**Free.** Every plan can create layouts and nest them.
:::

## What a layout is

A layout holds the furniture many screens have in common — header, navigation, footer,
a cookie banner, a site-wide search box. Bind a screen to a layout in the Besigner and
the layout chrome wraps the screen both in the editor and on the published site.

Because the chrome lives in one document, changing it changes every screen bound to it at
once. That is the point, and it is also the thing to keep in mind before you publish: see
[Versions & scheduled publishing](versions-and-publishing.md).

## Nested layouts

A layout can render inside **another layout**. Set **Renders inside** on a layout's detail
page and its chrome is wrapped by the outer layout's, exactly as a screen is wrapped by
its own — so site-wide furniture can live in one place while a section keeps a more
specific frame around it.

A screen inherits the whole chain: bind it to the inner layout and it renders inside that,
which renders inside the outer one, up to five layouts deep.

A layout can never sit inside itself, or inside a layout already nested within it — that
would be a loop with no outermost frame to render. The picker only offers layouts that
are legal choices, so you cannot select one by mistake.

## Layout properties

A layout can take **properties**, the way a
[reusable component](../besigner/reusable-components.md#properties) does, so one frame can
differ from screen to screen — a banner one screen shows and another hides, a call to action
worded per page — without a second layout.

1. Open the layout in the Besigner and choose **File ▸ Properties…**
2. **Add property**. Every property type a reusable component offers is here, with its
   default, help, settings and condition set with the same controls.
3. Inside the layout, put the property's token — `{{prop.bannerText}}` — in any text or
   string attribute, or bind a field to it with the field's `{}` button: a switch to a
   Yes / no, an icon picker to an Icon. **Hide when** and **Hide unless** take a property
   too, so a screen can remove part of the layout's chrome.

Each screen sets the values in **Screen Properties**, under **Shared layout**, below the
**Layout** picker: one field per property, drawn with the control its type names. Leave a
field empty and the layout's default renders. **Save layout values** stores them on the
screen version being edited, beside its layout binding, so publishing that version publishes
its values with it.

Values are kept per layout. Binding a screen to a different layout starts from that
layout's defaults, and a screen inside nested layouts sets each layout's properties
separately.

Properties saved on the layout's published version reach live screens straight away — that
version is what they render. On any other version they go live when you publish it.

Pages the site builds without a screen of their own — search results, author pages, and a
collection with no template screen — render inside the site's built-in page layout with its
properties' defaults.

## Duplicate

**Duplicate…** in a layout's row menu (and under **More** on its detail page)
makes a second layout with the same element tree and properties as the latest
saved version, named `Copy of <layout>` unless you type another name. No
screen uses the copy until you assign it, so nothing on the live site changes.
The copy counts against your shared-layout allowance like a new layout.

## Generate a layout with Aglyn AI

An AI build job can make a layout from a brief: the header, navigation and footer you have in
mind. The job proposes a plan first, and builds once you confirm it: a header that links your
screens, the slot each page renders in, and a footer. When your site already has a navigation
or menu component, the layout places it rather than building another. The layout follows
[the building rules](../../ai/how-aglyn-ai-builds.md), so it carries no page title of its own
and takes its colors and type from your theme.

The layout arrives as a new draft in **Layouts**, and **Open draft** on the job opens it in the
Besigner. No screen uses it until you assign it, so nothing on the live site changes. It counts
against your shared-layout allowance like a layout you create yourself, and when the site has
none to spare the job says so before it starts, not after it has spent anything.

## Used by

A layout's detail page has a **Used by** card listing everything that renders inside it,
so you can see what a change or a deletion would reach:

- **screens** bound to it, published or not, and
- **layouts nested inside it** — deleting the outer one unwraps every screen underneath
  those too.

A layout used by neither is genuinely unused.

## Layouts vs. reusable components

Both let you build something once and use it in many places, and they are not
interchangeable:

| | Layout | [Reusable component](../besigner/reusable-components.md) |
| --- | --- | --- |
| What it is | A frame with a slot | A subtree you insert as an instance |
| How a screen uses it | Binds to it; the layout wraps the screen | Inserts one or more instances anywhere in its own tree |
| How many per screen | One chain, outermost first | As many instances as you like |
| Where properties are set | Screen Properties, per screen | The Attributes panel, per instance |
| Good for | Header, nav, footer, site chrome | A card, a call-to-action, a pricing block |

If the thing wraps your content, it is a layout. If the thing *is* content you want to
repeat, it is a reusable component.

## Related

- [Screens](screens.md)
- [Versions & scheduled publishing](versions-and-publishing.md)
- [Reusable components](../besigner/reusable-components.md)
- [Menus & navigation](../menus-and-navigation/overview.md)
