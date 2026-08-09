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
- **Colors** — text color, background color, and **Background Fill**
  (see [gradient backgrounds](#gradient-backgrounds)). Both pickers open
  on **theme color references** first (see
  [scheme-scoped colors](#scheme-scoped-colors)); a *Custom color*
  step reveals the full picker. The two color fields hold a *color* — a
  hex, an `rgb()`/`hsl()` value, or a theme reference. Paste anything
  else (a gradient, a `url(…)`) and the field says so and refuses it,
  rather than saving a value the browser would silently drop.
- **Sizing** — width, height, and the min/max bounds for both.
- **Typography** — font size, weight, family, line height, letter
  spacing, text transform, and text decoration.
- **Borders & Shadows** — border shorthand, border color (with your
  theme palette in the picker), a border field per edge (top, right,
  bottom, left) for dividers and accent rails, corner radius, outline,
  and a shadow preset menu (Subtle / Medium / Large / None). The
  shorthand draws all four edges; use the per-edge fields when you want
  a rule under a header or a line between columns.
- **Position & Overflow** — position scheme with top/right/bottom/left
  offsets, z-index, overflow, opacity, and cursor.
- **Grid & Flex Child** — grid template columns/rows, auto-flow, and
  the per-item controls: grid column/row placement, flex grow, flex
  shrink, flex basis, and order.

Length fields — width, height, the min/max bounds, font size, letter
spacing, the position offsets, and flex basis — are a **number box plus
a unit menu**, the same pairing as the box stylers, so you type the
number and pick px, %, rem, vh, `auto` and the rest from the menu
rather than typing the unit yourself. Anything richer than a plain
length (`calc(100% - 2rem)`, `min-content`, a `{{token}}` binding) stays
editable as text and is never rewritten. Gap, corner radius, and line
height stay plain text fields: a bare number there means a *theme*
multiple, not pixels. Gap, row gap, column gap, corner radius and line
height each carry a **?** you can hover for the exact rule, and they are
the only fields that do — every other field explains itself in the line
printed under it.

Every control **applies immediately** — toggles and switches on click,
text fields on a short pause in typing (or when focus leaves the
field). There is no Save button in the styles panel; undo/redo covers
you as usual. Everything writes through the same responsive pipeline,
so the active breakpoint scope applies — and each group saves only its
own properties, never touching values you set elsewhere.

## Gradient backgrounds

**Background Fill** in the Colors group builds a gradient by clicking —
no custom CSS.

1. Set **Background Fill** to *Linear gradient* (or *Radial
   gradient*) — the field opens as that one select. It starts
   from your theme's primary and secondary colors so you see a gradient
   immediately; *Solid color* paints no image and hands the element back
   to the Background Color field above.
2. Set the **Angle** in degrees for a linear fill — `180` runs top to
   bottom, `90` left to right.
3. Edit the **color stops**. Each stop is a color button plus a position
   in percent. The color button opens the same two-stage picker as every
   other color field, so a stop can be a **theme color** (it then follows
   your palette, in both light and dark) or a literal hex. One gradient
   can mix the two — bind the ends to Primary and Secondary and drop a
   literal mid-tone between them. **Add stop** adds one near the end of
   the ramp, ready to be positioned; a gradient always keeps at least
   two, so the remove button greys out at two.

Background Fill writes `background-image`, which paints *over* the
Background Color — so a solid color set there still shows through
anywhere the gradient is transparent, and stays as the fallback if you
switch the fill back to solid.

The first choice in the menu — *Default*, or *Inherited* on a component
instance — is not the same as *Solid color*. **Default** leaves the fill
unset; **Solid color** is a positive "paint no image" (`background-image:
none`). On an ordinary element they look identical, and on a
[component instance](reusable-components.md#restyle-one-instance) they are
the difference between keeping the component's gradient and replacing it
with your own background color.

Like the other color fields, Background Fill is
[scheme-scoped](#scheme-scoped-colors): theme-color stops adapt on their
own, and while the artboard previews dark you can give dark a different
gradient outright.

A background richer than the stop editor can show — a `conic-gradient`, a
`to bottom right` direction, a `url()` image, or **several comma-separated
layers** — opens as an editable CSS box instead, and is never rewritten.
Edit it back to a plain linear or radial gradient and the stop controls
come back.

That includes a stack: `linear-gradient(…), url(/hero.jpg)` is a tint over
a photo, and Background Fill keeps it exactly as written rather than
offering stop controls that could only describe the first layer. You can
edit the stack in that box, or build one in
[custom CSS](#custom-css-sx).

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
