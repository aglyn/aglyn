---
sidebar_position: 2
title: Edit your theme
description: Set colors, fonts, and light/dark schemes with a live preview.
---

# Edit your theme

Your **theme** controls how the whole site looks — applied consistently across every screen
and previewed live as you edit.

:::info Plan availability
**Free**.
:::

![Editing the site theme](/img/theme-builder/theme-editor.png)

## Open the editor

Go to **Setup → Theme editor**. Changes render in a **live preview** so you see them
immediately.

## Set colors and fonts

- Choose your **palette** and **typography**.
- Fonts load through a Google Fonts URL builder.
- Configure both **light and dark** schemes. Published sites follow the visitor's system
  scheme (or their choice in the theme mode switcher); anything you leave unset under
  **Dark** comes from the platform's default dark palette, so a site goes dark without a
  dark design of its own.
- **Dark scheme** — set it to **Off** when your content only reads well in light: every
  visitor stays on light and the theme mode switcher is hidden on published pages.

## It follows you into the Besigner

The theme you set here is supplied to the [Besigner](../besigner/overview.md) canvas, so what
you design previews under the real site theme in both light and dark.

Your palette also powers the Besigner's **color pickers**: every color field offers your
theme's colors as *references* first (Primary, Background, Surface, Text…), each swatch
previewing its light and dark resolutions. Elements colored by reference re-color
automatically when you adjust the theme — or when the visitor's scheme flips. See
[scheme-scoped colors](../besigner/responsive-styling.md#scheme-scoped-colors).

## Tips

- Set both schemes — a site that only looks right in light mode breaks for dark-mode
  visitors. Until it does, switch **Dark scheme** off rather than shipping unreadable pages.
- Prefer theme color *references* over fixed hex values when styling elements; references
  adapt per scheme, fixed colors don't (though the Besigner can scope custom colors per
  scheme too).
- The theme also styles screen previews and published pages, so there's one source of truth.

## Related

- [The Besigner](../besigner/overview.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
