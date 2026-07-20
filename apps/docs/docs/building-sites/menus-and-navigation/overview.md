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
| **Dropdown Menu** | A nav item that opens a dropdown of links — click-toggles out of the box, interactions do the rest. |
| **Mega Menu** | A SaaS-style wide panel with a free-form slot for columns of links and promos. |
| **Drawer** | A slide-in panel (left or right) with a slot for anything — the mobile menu building block. |
| **Menu Button** | A hamburger icon button that opens/closes a drawer. |
| **Mobile Nav** | A one-insert preset: menu button + drawer + inline desktop links, responsive wiring included. |

All of them render **closed on the live site until the visitor interacts**,
and the canvas mirrors that: menus show just their trigger and drawers a
slim placeholder. **Select the element — or anything inside it — and it
expands in place** so its contents stay selectable and editable; click
elsewhere and it collapses again.

## Dropdown menu

Insert **Dropdown Menu**, set its **Label**, and drop screen links (or
anything else) inside. Its only attribute is **Label** — how the menu
opens is not an attribute:

- **By default, clicking the nav item toggles the menu.** No
  configuration needed; the menu also closes on outside clicks and
  <kbd>Esc</kbd>.
- **Everything else is an [interaction](#interactions-for-menus)** —
  e.g. *When hovered → Open a menu* on the menu element itself gives you
  a hover menu, and any other element can open, close, or toggle any
  menu.

Menus opened by a hover interaction close themselves once the pointer
leaves the nav item and its panel, with a short grace period so the
pointer can travel between the two.

## Mega menu

Insert **Mega Menu** inside your nav bar. Its panel is a normal canvas
slot — the preset starts you with three columns of links, but rows,
images, and promo cards all work. Attributes:

- **Panel width** — *Fit content*, *Wide* (720px), or *Full width*
  (edge-to-edge under the nav item).

It opens exactly like the dropdown: click-toggle by default, and the
classic SaaS hover behavior is one interaction — on the mega menu
element, *When hovered → Open a menu* (the target defaults to the
element itself). Hover-opened panels close on pointer leave
automatically.

## Drawer & menu button

The **Drawer** slides in from the page edge and holds any canvas
children — typically a vertical stack of screen links. It opens three
ways:

1. A **Menu Button** element. **Clicking it toggles the page's first
   drawer — no configuration at all** (which is why the Mobile Nav
   preset works with zero wiring). Its only attribute is
   **Accessibility label**; how it targets a drawer is not an attribute.
2. An **interaction** with the *Open / Close / Open-close a drawer*
   actions ([below](#interactions-for-menus)) — on the Menu Button
   itself when a page has several drawers and you need to point it at a
   specific one, or on any other element.
3. The built-in close button, backdrop click, or <kbd>Esc</kbd> — closing
   is always handled for you.

Drawer attributes: **Slides in from** (left/right) and **Width**. The
canvas renders the drawer inline at its configured width, so its links
and headers stay full-size and editable.

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
  a list of canvas elements), *Open / Close / Open-close a menu* (drives
  a Dropdown or Mega Menu; picking defaults to the element itself when it
  is a menu, or the page's first menu), and *Open / Close / Open-close a
  drawer* (defaults to the element itself when it is a drawer, or the
  page's first drawer).
- **Frequency**: new interactions default to **Every time** so toggles
  keep working; the legacy *once per page view* and the per-session /
  per-visitor / cooldown caps are still there for announcements.

Three patterns cover most menus:

- **Hover menu** — on the Dropdown/Mega Menu element itself: *When
  hovered → Open a menu*. Leaving the nav item and its panel closes it
  automatically — no hover-ends interaction needed.
- **Custom hover reveal** — on the trigger element: *When hovered → Show
  an element* (your panel), plus a second interaction *When hover ends →
  Hide an element*.
- **Custom hamburger** — on any button or icon: *When clicked →
  Open/close a drawer* (or *a menu*).

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
Pick a device in the artboard preview switcher and the canvas renders
at that width — bands apply, the Mobile Nav swaps to its menu button,
and breakpoint-scoped styles resolve for that device. In **Fluid
Responsive** mode the canvas follows the real browser window instead.
See [responsive styling](../besigner/responsive-styling.md) for how
breakpoint-scoped styles behave on the canvas.
:::

## Related

- [Walkthrough: build a mega menu with hover interactions](../../guides/mega-menu-with-interactions.md)
- [Interactions & custom HTML](../besigner/interactions-and-custom-html.md)
- [Responsive styling & custom CSS](../besigner/responsive-styling.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
