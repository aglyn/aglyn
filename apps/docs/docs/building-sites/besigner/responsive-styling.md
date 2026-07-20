---
sidebar_position: 9
title: Responsive styling & custom CSS
description: Style per breakpoint from the artboard preview, use the box stylers, custom classes, and the CSS builder.
---

# Responsive styling & custom CSS

![The toolbar with the fluid-responsive mode and device previews](/img/besigner/besigner-editor.png)

## Style per breakpoint

The artboard preview mode now doubles as your styling scope:

- **Fluid Responsive** (default) — style edits apply at **every** screen
  size.
- **XS / SM / MD / LG / XL** — edits in the styles panel apply **from
  that breakpoint up**, following the mobile-first cascade. Switch to
  *SM – Tablet*, change a padding, and phones keep the base value while
  tablets and up take the new one.

A chip at the top of the styles panel always shows the active scope
("Styling: all screen sizes" or "Styling breakpoint: SM"). Values you
*don't* touch keep inheriting — opening a panel at a breakpoint never
pins anything by itself.

Selecting a device also re-renders the canvas at that width: responsive
values (`{ xs, md }`), [visibility bands](#visibility-per-device-band),
and breakpoint-driven component layouts all resolve as they will on a
real device of that size — the published site is untouched by preview
mode.

## Box stylers

The margin/padding stylers are fully interactive:

- Pick the fan-out with **Side / Axis / All**: one side at a time, the
  vertical or horizontal pair together, or all four sides at once.
- Click any side in the box diagram to edit its value inline, or use the
  per-side fields — each with a unit menu (px, %, em, rem, vh, vw…).
- Everything respects the active breakpoint scope.

## Style groups

The styles panel organizes every control into accordions, and every
field has exactly one home — no custom CSS needed for the common
properties:

- **Flexbox & Grids** — the container controls: alignment and
  direction toggles plus the gap, row-gap, and column-gap fields.
- **Layout** — display variant and float.
- **Colors** — text color and background color. Both pickers open on
  **theme color references** first (see
  [scheme-scoped colors](#scheme-scoped-colors)); a *Custom color*
  step reveals the full picker.
- **Sizing** — width, height, and the min/max bounds for both.
- **Typography** — font size, weight, family, line height, letter
  spacing, text transform, and text decoration.
- **Borders & Shadows** — border shorthand, border color (with your
  theme palette in the picker), corner radius, outline, and a shadow
  preset menu (Subtle / Medium / Large / None).
- **Position & Overflow** — position scheme with top/right/bottom/left
  offsets, z-index, overflow, opacity, and cursor.
- **Grid & Flex Child** — grid template columns/rows, auto-flow, and
  the per-item controls: grid column/row placement, flex grow, flex
  shrink, flex basis, and order.

Every control **applies immediately** — toggles and switches on click,
text fields on a short pause in typing (or when focus leaves the
field). There is no Save button in the styles panel; undo/redo covers
you as usual. Everything writes through the same responsive pipeline,
so the active breakpoint scope applies — and each group saves only its
own properties, never touching values you set elsewhere.

## Visibility per device band

The **Visibility** accordion hides the selected element on whole device
bands — **mobile** (under 600px), **tablet** (600–899px), and
**desktop** (900px and up). Bands are range-scoped rather than
mobile-first, so hiding one band never changes the element's display on
the others — the classic "hide the link cluster on mobile, show a menu
button instead" swap is two toggles
([menus & navigation](../menus-and-navigation/overview.md)).

On the canvas, bands follow the artboard: select a device in the
preview switcher and the matching band applies at that device's width —
XS shows the mobile band, SM the tablet band, MD and up the desktop
band. In Fluid Responsive mode the canvas follows the real browser
window instead, so resize the window (or open the published site) to
see bands flip.

## Scheme-scoped colors

Published sites follow each visitor's **light/dark scheme** (system
setting, or their own choice via the theme mode switcher component), so
a hardcoded light-mode hex can be unreadable in dark mode. Two tools
keep colors correct in both schemes:

**Theme color references (preferred).** Every color picker — text,
background, and border color, plus color attributes on components —
opens on your site theme's palette references first: Primary,
Secondary, Background, Surface, Text, Divider, and friends. Each
swatch is split to preview its **light and dark** resolutions, and
selecting one stores the *reference* (e.g. `background.paper`), not a
fixed color — the element automatically re-colors when the site
switches schemes. Pick **Custom color** to reveal the full picker when
you really want a fixed value.

**Per-scheme custom colors.** The artboard's scheme toggle (the
sun/moon button in the toolbar) doubles as a styling scope, exactly
like the device preview does for breakpoints:

- **Light preview** (default) — color edits set the element's **base**
  colors, which both schemes share until dark overrides exist.
- **Dark preview** — the styles panel shows a **"Styling: dark
  scheme"** chip, and edits to *text, background, and border color*
  become **dark-only overrides**. Light mode keeps the base values;
  the canvas shows the dark result as you edit.

Only color fields scope to the scheme — spacing, sizing, typography,
and layout always apply to both schemes no matter which one you
preview. Clearing a color while previewing dark removes the override
and falls back to the base color. Scheme overrides compose with
[breakpoint scoping](#style-per-breakpoint): previewing dark on the
*MD – Laptop* artboard writes a dark override that applies from MD up.

## Custom classes

Every element accepts **Classes** (chips input under *Classes & custom
CSS*). They merge into the rendered element, so you can target them from
theme styles and from [interaction class actions](interactions-and-custom-html.md).

## Custom CSS (sx)

The *Classes & custom CSS* section edits the element's `sx` in three
modes:

- **Builder** — property + value rows with grouped suggestions (layout,
  spacing, typography, background, border, effects).
- **CSS** — paste plain declarations (`border-radius: 8px;`); they parse
  into the element's styles at the active breakpoint scope.
- **JSS (sx)** — the full document as JSON, including responsive objects
  (`{ xs, md }`) and nested selectors (`"&:hover"`), for full control.

## Semantic sections & theme mode

- The **Section** component groups children inside a real HTML element —
  `section`, `article`, `aside`, `nav`, `header`, `footer`, `main`, or
  `div` — keeping your page outline meaningful for SEO and assistive
  tech.
- The **Theme mode switcher** component gives visitors a light/dark/
  device-default override that persists across visits.

## Edit JSON for one element

Right-click any element → **Edit JSON** to edit just that element and
its children as JSON (the rest of the screen is untouched). Apply
validates component ids and node ids, and the change is undoable.
