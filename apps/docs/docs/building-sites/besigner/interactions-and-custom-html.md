---
sidebar_position: 8
title: Interactions & custom HTML
description: Build element interactions in one dialog and drop sanitized custom markup anywhere.
---

# Interactions & custom HTML

![The node toolbar on a selected element](/img/besigner/canvas-selected.png)

## Fluent interactions

Select any element and use **Add interaction** — everything configures in
one dialog without leaving the besigner:

- **Trigger**: when the element is clicked, **hovered**, the **hover
  ends**, or it scrolls into view.
- **Frequency**: **every time** (the default — repeatable, for menu and
  drawer toggles), once per page view, once per session, once per
  visitor, or with a cooldown.
- **Actions** (stack as many as you need). The **basic** actions below are
  pure in-page choreography — available on **every plan** (see
  [Plan availability](#plan-availability)):
  - **Show / hide / show-hide an element** — pick any other canvas
    element from a list; no selectors or classes needed. Add the
    `aglyn-hidden` class to a target to start it hidden on the live
    site. Each of these takes an optional **Delay** (a later
    show/hide on the same target cancels a pending one — the classic
    hover grace period) and, for steps that can show, **Close on
    Esc** / **Close on outside click** so a revealed panel dismisses
    itself like a real menu.
  - **Open / close / open-close a menu** — drives a
    [Dropdown or Mega Menu element](../menus-and-navigation/overview.md).
    The target defaults to the element itself when it is a menu; leave it
    empty to address the page's first menu. A menu opened by *When
    hovered* closes itself when the pointer leaves the nav item and its
    panel.
  - **Open / close / open-close a drawer** — drives a
    [Drawer element](../menus-and-navigation/overview.md); leave the
    target empty to address the page's first drawer.
  - **Toggle / append / remove a class** — targets this element by
    default, or any CSS selector. Pair with your theme's utility classes
    for menus, reveals, and state changes.
  - **Make the nav sticky**, **go to a URL / screen**, or **show a site
    alert** — navigation and lightweight feedback, no server involved.
- The remaining actions are the **automations engine** (Pro+, metered —
  see [Plan availability](#plan-availability)):
  - **Open an overlay**, **show custom HTML**, or **track an analytics
    event** in the page.
  - **Run custom JavaScript** (Business tier).
  - **Server steps** — run a workflow, send an email, notify admins,
    enroll a contact in a list, update a dataset, or assign a campaign.
    Workflows, overlays, lists, and datasets are picked from lists — never
    typed by name — so renames can't break them.
- **Test** runs class and show/hide actions against the canvas
  immediately and explains what the other actions will do on the live
  site.

Saved interactions are **enabled immediately** and appear on the element's
Interactions list with edit (✎), enable/disable, and remove controls.

## Plan availability

Interactions come in two tiers, and the field editor labels the steps that
need a higher plan:

- **Basic interactions — every plan, including Free.** Opening and closing
  menus and drawers, showing and hiding elements, toggling classes, sticky
  nav, navigation, and site alerts are pure client-side DOM behavior with
  **no server cost**. They run everywhere and are **never metered** — a
  hover-to-open menu is not a paid feature.
- **The automations engine — Pro+, metered.** Steps that reach the server
  or a data pipeline — overlays, analytics events, custom JS (Business),
  and the server steps (workflows, email, datasets, campaigns) — require
  the `actions` entitlement and count against your monthly action runs.

On a plan without the automations entitlement, an interaction that mixes
tiers still runs its **basic** steps live; the Pro+ steps are simply
skipped until you upgrade. See
[workflows & actions](../../marketing-and-automation/workflows-and-actions/actions-builder.md)
for the full step catalog and metering.

## Pick the target by clicking

Any action that points at an element — *open a menu*, *show / hide*, *open
a drawer* — lets you **choose the target visually**: click **Pick element**,
click the element on the canvas, and confirm. No CSS selectors to write,
and the picker resolves the stable `data-aglyn` id under the hood so the
target survives edits. A **custom selector** field is there as a secondary
option for advanced cases (a class or attribute selector you maintain
yourself).

### Interaction cookbook

- **Hamburger menu**: on any button, *When clicked → Open/close a
  drawer*. (The [Menu Button element](../menus-and-navigation/overview.md)
  does this without any interaction at all.)
- **Hover menu**: on a Dropdown or Mega Menu element, *When hovered →
  Open a menu* at frequency *every time*. Clicking already toggles every
  menu with zero configuration; this adds the hover-open, and the menu
  closes itself when the pointer leaves.
- **Hover reveal**: *When hovered → Show an element* plus *When hover
  ends → Hide an element*, both at frequency *every time*.
- **Mega menu from scratch** (no Mega Menu element): wrap a trigger
  button and a panel in one Stack (panel: `aglyn-hidden` class,
  position absolute below the trigger). On the wrapper: *When hovered →
  Show* the panel, *When hover ends → Hide* it with a small **Delay**
  (say 250ms) so the pointer can travel; add **Close on Esc** to the
  show step for keyboard dismissal. The **Dropdown Panel** preset
  (Navigation group) inserts exactly this pattern with both
  interactions pre-wired — see
  [menus & navigation](../menus-and-navigation/overview.md#the-dropdown-panel-preset).
- **Scroll reveal**: on a section, *When scrolled into view → Append class
  `visible`* with a CSS transition, frequency *once per visitor*.
- **Announcement click-through**: *When clicked → Track analytics event*
  plus *Go to a URL*.

## Custom HTML block

The **Custom HTML** block accepts markup and CSS with a strict safety
model:

- **Sanitized by default** — scripts, iframes, objects, forms, and inline
  event handlers (`onclick` etc.) are stripped on every render. What you
  paste can style and structure, never execute.
- **Embed mode** for third-party widgets: the raw snippet runs inside a
  **sandboxed iframe** with scripts allowed but no access to your site,
  cookies, or visitor data. Set the iframe height to fit the widget.

Prefer first-party blocks where one exists — embeds can't participate in
theming or interactions.

## Related

- [Walkthrough: build a mega menu with hover interactions](../../guides/mega-menu-with-interactions.md)
- [Menus & navigation](../menus-and-navigation/overview.md)
- [Besigner overview](overview.md)
- [Workflows & actions](../../marketing-and-automation/workflows-and-actions/overview.md)
