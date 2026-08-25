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
| Good for | Header, nav, footer, site chrome | A card, a call-to-action, a pricing block |

If the thing wraps your content, it is a layout. If the thing *is* content you want to
repeat, it is a reusable component.

## Related

- [Screens](screens.md)
- [Versions & scheduled publishing](versions-and-publishing.md)
- [Reusable components](../besigner/reusable-components.md)
- [Menus & navigation](../menus-and-navigation/overview.md)
