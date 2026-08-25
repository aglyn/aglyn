---
sidebar_position: 10
title: Text styles & theme tokens
description: Style from your site's theme instead of typing pixels, so a brand change moves every page at once.
---

# Text styles & theme tokens

Every site has a **theme** — a named set of type sizes, weights, colours,
spacing steps and shadows. The styles panel offers those names wherever one
exists, and picking a name is almost always the better answer than typing a
number.

## Why a name beats a number

Type `13px` into Font Size and that element is now pinned to 13 pixels
forever. Pick **Body compact** and the element follows your theme: if the
brand later decides small text should be 14px, every element that asked for
*Body compact* moves, and the ones that were told `13px` stay behind.

The same applies to weight, spacing, corner radius and shadow. Each control
that can follow the theme shows you what the name resolves to today — *Bold
(theme)* sits next to `700`, *Small* next to `16px` — so you can see the value
without hard-coding it.

## Text Style sets everything at once

**Text Style** is the first control in the Typography group, and it is the one
pick that can be right on its own. It applies the whole style — face, size,
weight, line height and letter spacing — in a single choice.

The fields under it (Font Family, Font Size, Font Weight, and so on) are
**adjustments on top** of a text style, not the way to build one. Reach for
them when you need a deliberate exception, not to reconstruct a heading by
hand.

:::tip Start with Text Style
If you find yourself setting size *and* weight *and* line height to match a
heading elsewhere on the site, stop — that is a Text Style, and matching it by
hand will drift the moment either place changes.
:::

## What your theme offers

Aglyn's default theme carries the standard set plus a few rungs of its own.
Your own theme may differ; the panel always lists what **your** site defines.

| Text style | Typical use |
| --- | --- |
| Heading 1 – Heading 6 | Page and section headings |
| Lede | The intro paragraph under a heading |
| Body / Body small | Running text |
| Body compact | Dense labels and card text |
| Caption | Small print under an element |
| Micro | Metadata lines, fine detail |
| Overline | The small label above a heading |
| Button | Button text |

Font weights are named too — Light, Regular, Medium, Semi bold, Bold, Extra
bold and Black — and each row shows the number it resolves to.

## Colours, spacing and shadows

The same rule runs through the rest of the panel:

- **Colours** — pick from your theme's palette rather than pasting a hex code.
  A palette colour follows a rebrand; `#00B0FF` does not.
- **Spacing, Gap, Margin and Padding** — the ladder (None, Extra small, Small,
  Medium, Large…) are multiples of your theme's spacing unit. `Small` stays
  correct if that unit changes.
- **Corner Radius** — Square through Very rounded are multiples of your
  theme's shape scale. *Pill* and *Circle* are shapes rather than theme
  values, so those two are deliberately fixed.
- **Shadow** — the rungs are your theme's elevation ladder, and each row
  previews the shadow it will draw.

Every one of these controls keeps a **Custom…** entry. The escape hatch is
always there when a design genuinely needs a one-off — it is simply not the
default.

## Checking a page you already built

Open the styles panel on an element and look at the Typography group. If Font
Size and Font Weight are filled in on a heading, that heading is describing
itself in numbers rather than asking for a Text Style. Clearing those two and
picking the matching Text Style leaves it looking the same today and keeps it
correct tomorrow.

:::note Changing the theme itself
Editing the theme changes every site that uses it, so it is a separate,
deliberate step rather than something you do while styling one page. If a
value you need has no name yet, that is a sign the theme is missing a rung —
worth adding once, rather than typing the same number on twenty pages.
:::
