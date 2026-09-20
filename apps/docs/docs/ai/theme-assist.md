---
sidebar_position: 7
title: Themes with AI
description: Describe a change to your site's theme and get a proposal for the theme editor's own controls, previewed before and after, that you save in the editor.
---

# Themes with AI

The **Theme assistant** sits on your site's **Setup → Theme** section, above the
[theme editor](../building-sites/theme-builder/edit-your-theme.md). Describe what you
want and it proposes values for the editor's own controls — the same colors, font,
corner radius, spacing, navigation heights, dark scheme and component overrides you can
set by hand. Nothing changes on your site until you save.

## Change what you describe, or design a new theme

- **Change what I describe** makes a targeted change. "Make it feel warmer" proposes new
  colors and leaves your font, corners and spacing alone; "bigger headings on mobile"
  changes heading sizes on phones and nothing else. Anything the proposal does not name
  keeps its current value.
- **Design a new theme** proposes a complete look — accents, backgrounds, text and their
  dark values — from a brief like "warm and editorial, deep green primary, serif headings".

## Match your brand

- A hex color in your description, such as `#1a73e8`, is used exactly as written.
- The assistant reads the colors of your site logo when the logo comes from your media
  library.
- Paste a link to a public page and the assistant borrows the colors that page uses.
- In a white-label workspace, the workspace's brand color is offered as a starting point.

## Review the proposal

Each proposal shows:

- **What changes** — every control it sets, with its current value and the proposed one.
- **Before and after** — the editor's own preview, in light and in dark.
- **Adjusted for readability** — body text needs 4.5:1 against the page and the paper, and
  the primary color 3:1 against the page. A pair the proposal would take below that is moved
  to the nearest shade that clears it, and the change is named.
- **Dark values** — visitors get your dark scheme unless you switched it off, so an accent
  changed for light also gets a dark value that keeps its hue.

If your theme has changed since a proposal was made, the preview applies the proposal to
the theme as it is now, and says so.

## Save it, or don't

**Put in the editor** places the proposal in the theme editor as unsaved changes. Review or
adjust them there, then **Save** — or **Discard changes** to go back. The save is stored the
way any edit to your theme is:

- **An installed theme** keeps the publisher's version and stores your changes on top of
  it, so it can still take updates.
- **The default theme** stores only the values you save.
- **Your own theme** changes in place.

Your site's recent proposals stay listed on the card, so one that finished while you were
elsewhere is still there to preview.

## Who can use it

The assistant needs AI generation on your plan and the **Generate with AI** permission —
see [Custom roles & permissions](../workspace-and-billing/teams-and-roles/custom-roles.md#ai-permissions).
Each proposal draws on your workspace's AI credits like any other AI request.

## Related

- [Edit your theme](../building-sites/theme-builder/edit-your-theme.md)
- [AI Assist](overview.md)
