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

## Choose a theme

The **Theme** card at the top of the page picks the theme your site runs:

- **Built-in** — **Material UI (default)**, plus any built-in themes your plugins add. Each
  one restyles components (buttons, inputs, cards, tabs, alerts) as well as colors and type.
- **Your themes** — themes you saved from this site.
- **From the marketplace** — themes you installed.

Choosing a theme shows a **preview** first, in light and dark; **Use this theme** applies it
to the live site.

**Your edits never change the theme itself.** Everything you set in the editor below is
stored as your edits *on top of* the theme you picked, so:

- **Restore** drops your edits and brings the theme back exactly as it was.
- **Save as custom theme** saves the result — the theme plus your edits — as a new theme of
  your own under **Your themes** and switches to it. The theme you started from stays in the
  list, unchanged.
- **Update** (on one of your own themes) folds your edits into that theme.
- **Switching themes keeps your edits.** Each theme remembers the edits you made to it, and
  they come back when you pick it again. Themes marked **Edited** in the list have some.

Your **Dark scheme** setting belongs to the site, not the theme, so it stays as you set it
whichever theme you pick.

## Set colors and fonts

- Choose your **palette** and **typography**.
- Fonts load through a Google Fonts URL builder.
- Configure both **light and dark** schemes. Published sites follow the visitor's system
  scheme (or their choice in the theme mode switcher); anything you leave unset under
  **Dark** comes from the platform's default dark palette, so a site goes dark without a
  dark design of its own.
- **Dark scheme** — set it to **Off** when your content only reads well in light: every
  visitor stays on light and the theme mode switcher is hidden on published pages.

## Style components

**Component overrides** restyle MUI components site-wide beyond the palette and type. The
editor takes MUI's component theme API as JSON, keyed by component (`MuiButton`,
`MuiOutlinedInput`, `MuiCard`, `MuiAlert`…):

- `defaultProps` — a prop's default, e.g. `{ "variant": "outlined" }`.
- `styleOverrides` — literal CSS per slot. `"padding": 8` is 8px.
- `sx` — the same per-slot styles in **theme terms**, resolved separately for light and
  dark: palette paths (`"borderColor": "divider"`, `"bgcolor": "primary.main"`), spacing
  units (`"px": 2` is 16px), radius multiples (`"borderRadius": 2`), shadow levels
  (`"boxShadow": 3`) and whole text styles (`"typography": "button"`). Use it for anything
  that should follow the scheme.
- `variants` — styles that apply only when props match, e.g.
  `{ "props": { "variant": "outlined" }, "sx": { "borderWidth": 2 } }`.

```json
{
  "MuiCard": {
    "defaultProps": { "variant": "outlined" },
    "sx": { "root": { "borderColor": "divider", "borderRadius": 2 } }
  }
}
```

Your overrides are added to the platform's own component styles rather than replacing them,
so the contrast fixes the platform applies to buttons and links stay in place.

## It follows you into the Besigner

The theme you set here is supplied to the [Besigner](../besigner/overview.md) canvas, so what
you design previews under the real site theme in both light and dark.

Your palette also powers the Besigner's **color pickers**: every color field offers your
theme's colors as *references* first (Primary, Background, Surface, Text…), each swatch
previewing its light and dark resolutions. Elements colored by reference re-color
automatically when you adjust the theme — or when the visitor's scheme flips. See
[scheme-scoped colors](../besigner/responsive-styling.md#scheme-scoped-colors).

## Change it with AI

**Rolling out.** The **Theme assistant** above the editor proposes changes to these same
controls from a description — "warmer", "match our brand", "bigger headings on mobile" —
with a before and after preview. A proposal goes into the editor as unsaved changes, and
nothing is saved until you save it. See
[Change your site's theme with AI](../../ai/theme-assist.md).

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
