---
sidebar_position: 1
title: Screens & Layouts
description: Screen hierarchy and routing, shared layouts, reusable components, and versioning.
---

# Screens & Layouts

Screens are your pages; layouts are the shared frames they render inside. Together they
define your site's structure, URLs, and reusable chrome.

The screen hierarchy maps directly to your URL paths:

```mermaid
flowchart TD
  Home["Home — /"] --> Services["Services — /services"]
  Home --> About["About — /about"]
  Services --> Pricing["Pricing — /services/pricing"]
  Services --> Support["Support — /services/support"]
```

:::info Plan availability
**Free** for core screens and layouts. Higher tiers raise caps on screens, versions, and
reusable components.
:::

![Editing a screen in the Besigner](/img/besigner/besigner-editor.png)

![The screens list](/img/getting-started/screens-list.png)

## Screens & routing

- Each screen has a **title** and a URL **slug**. Aglyn normalizes slugs and keeps a
  site **routing map**.
- Screens form a **hierarchy**: pick a parent and the child inherits a nested path
  (`/services/pricing`). Changing a slug or parent cascades safe rewrites across the map,
  with cycle guards so you can't create a loop.
- Reorder the hierarchy with **drag-and-drop** in the screens list.

## Layouts

A **layout** is a shared frame (header, nav, footer) with a **slot** where screen content
renders. Bind a screen to a layout in the Besigner and the layout chrome wraps the screen
both in the editor and on the published site. Layouts have their own versions and admin
converters, just like screens.

### Nested layouts

A layout can render inside **another layout**. Set **Renders inside** on a layout's detail
page and its chrome is wrapped by the outer layout's, exactly as a screen is wrapped by
its own — so site-wide furniture can live in one place while a section keeps a more
specific frame around it.

A screen inherits the whole chain: bind it to the inner layout and it renders inside that,
which renders inside the outer one, up to five layouts deep.

A layout can never sit inside itself, or inside a layout already nested within it — that
would be a loop with no outermost frame to render. The picker only offers layouts that
are legal choices, so you cannot select one by mistake.

### Used by

A layout's detail page has a **Used by** card listing everything that renders inside it,
so you can see what a change or a deletion would reach:

- **screens** bound to it, published or not, and
- **layouts nested inside it** — deleting the outer one unwraps every screen underneath
  those too.

A layout used by neither is genuinely unused.

## Reusable components

Promote a subtree into a **reusable component** and insert instances anywhere. Instances
graft the source at render time, so one edit updates them all. Manage (rename / demote /
delete) reusable components from the site dashboard.

## Versions & scheduled publishing

- Save **named versions** of a screen or layout.
- **Schedule** a version to publish at a future time.
- Delete versions you no longer need.
- The **version dropdown** lives in the app bar near your avatar for quick switching.

## Error & maintenance screens

You can design custom **404 / 401 / 403 / 503** screens and turn on **maintenance mode**.
See [Site protection & error pages](../site-protection/overview.md).

## Related

- [The Besigner](../besigner/overview.md)
- [Bindings & variables](../bindings/overview.md)
- [SEO toolkit](../seo/overview.md)
