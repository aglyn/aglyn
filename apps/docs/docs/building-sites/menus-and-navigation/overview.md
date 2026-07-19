---
sidebar_position: 1
title: Menus & navigation
description: Dropdown menus, hover mega menus, and slide-in drawers — authorable entirely in the besigner.
---

# Menus & navigation

Real navigation needs more than a row of links. The **Navigation** group
in the element picker ships menu elements with the interactivity built
in — no code, no raw JSON:

| Element | What it does |
| --- | --- |
| **Dropdown Menu** | A nav item that opens a dropdown of links on click or hover. |
| **Mega Menu** | A SaaS-style wide panel that opens on hover, with a free-form slot for columns of links and promos. |
| **Drawer** | A slide-in panel (left or right) with a slot for anything — the mobile menu building block. |
| **Menu Button** | A hamburger icon button that opens/closes a drawer. |
| **Mobile Nav** | A one-insert preset: menu button + drawer + inline desktop links, responsive wiring included. |

All of them render **closed on the live site until the visitor interacts**,
and render **expanded inline on the canvas** so their contents stay
selectable and editable — exactly like form fields do.

## Dropdown menu

Insert **Dropdown Menu**, set its **Label**, and drop screen links (or
anything else) inside. Attributes:

- **Label** — the text on the nav item.
- **Open on** — *Click* (default) or *Hover*. Hover menus keep a short
  grace period so the pointer can travel into the panel; click menus
  close on outside clicks and <kbd>Esc</kbd>.

## Mega menu

Insert **Mega Menu** inside your nav bar. Its panel is a normal canvas
slot — the preset starts you with three columns of links, but rows,
images, and promo cards all work. Attributes:

- **Open on** — *Hover* (default) or *Click*.
- **Panel width** — *Fit content*, *Wide* (720px), or *Full width*
  (edge-to-edge under the nav item).

## Drawer & menu button

The **Drawer** slides in from the page edge and holds any canvas
children — typically a vertical stack of screen links. It opens three
ways:

1. A **Menu Button** element. Leave its **Drawer** attribute empty to
   control the page's first drawer (which is why the Mobile Nav preset
   works with zero wiring), or pick a specific drawer element.
2. An **interaction** on any element with the *Open / Close / Open-close
   a drawer* actions ([below](#interactions-for-menus)).
3. The built-in close button, backdrop click, or <kbd>Esc</kbd> — closing
   is always handled for you.

Drawer attributes: **Slides in from** (left/right) and **Width**.

## The Mobile Nav preset

Insert **Mobile Nav** (Navigation group) into your nav bar's toolbar and
you get a working responsive pattern immediately:

- a **Menu Button** — hidden on desktop,
- an inline **link row** — hidden on mobile and tablet,
- a **Drawer** with a vertical link stack, already answering the button.

Swap the placeholder links for your screens and you're done. The
show/hide wiring is plain [visibility styling](#responsive-visibility),
so you can retune the breakpoints per element afterwards.

## Interactions for menus

The props panel's **Add interaction** system understands menu
choreography ([interactions guide](../besigner/interactions-and-custom-html.md)):

- **Triggers**: *When clicked…*, *When hovered…*, *When hover ends…*,
  *When scrolled into view…*
- **Actions**: *Show / Hide / Show-hide an element* (pick the target from
  a list of canvas elements) and *Open / Close / Open-close a drawer*
  (pick the drawer, or default to the page's first).
- **Frequency**: new interactions default to **Every time** so toggles
  keep working; the legacy *once per page view* and the per-session /
  per-visitor / cooldown caps are still there for announcements.

Two patterns cover most menus:

- **Custom hover reveal** — on the trigger element: *When hovered → Show
  an element* (your panel), plus a second interaction *When hover ends →
  Hide an element*.
- **Custom hamburger** — on any button or icon: *When clicked →
  Open/close a drawer*.

:::tip Start hidden
To make a show-target start hidden, add the `aglyn-hidden` class under
**Styles → Classes & custom CSS**. The live site hides it from the very
first paint; the canvas keeps it visible so you can keep editing it.
:::

## Responsive visibility

**Styles → Visibility** hides the selected element on whole device
bands:

- **Hide on mobile** (under 600px)
- **Hide on tablet** (600–899px)
- **Hide on desktop** (900px and up)

Use it to hide the desktop link cluster on small screens and show a menu
button instead. Bands are range-scoped, so hiding one never changes how
the element displays on the others.

:::note Canvas preview
Band visibility follows the **browser window width**, not the artboard
device preview — resize your window or check the published site to see
it apply. See [responsive styling](../besigner/responsive-styling.md)
for how breakpoint-scoped styles behave on the canvas.
:::

## Related

- [Interactions & custom HTML](../besigner/interactions-and-custom-html.md)
- [Responsive styling & custom CSS](../besigner/responsive-styling.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
