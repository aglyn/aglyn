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
- **Actions** (stack as many as you need):
  - **Show / hide / show-hide an element** — pick any other canvas
    element from a list; no selectors or classes needed. Add the
    `aglyn-hidden` class to a target to start it hidden on the live
    site.
  - **Open / close / open-close a drawer** — drives a
    [Drawer element](../menus-and-navigation/overview.md); leave the
    target empty to address the page's first drawer.
  - **Toggle / append / remove a class** — targets this element by
    default, or any CSS selector. Pair with your theme's utility classes
    for menus, reveals, and state changes.
  - **Show a message**, **run a workflow**, **open an overlay**, **go to
    a URL**, or **track an analytics event**. Workflows and overlays are
    picked from lists — never typed by name — so renames can't break them.
- **Test** runs class and show/hide actions against the canvas
  immediately and explains what the other actions will do on the live
  site.

Saved interactions are **enabled immediately** and appear on the element's
Interactions list with edit (✎), enable/disable, and remove controls.

### Interaction cookbook

- **Hamburger menu**: on any button, *When clicked → Open/close a
  drawer*. (The [Menu Button element](../menus-and-navigation/overview.md)
  does this without any interaction at all.)
- **Hover reveal**: *When hovered → Show an element* plus *When hover
  ends → Hide an element*, both at frequency *every time*.
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

- [Besigner overview](overview.md)
- [Workflows & actions](../../marketing-and-automation/workflows-and-actions/overview.md)
