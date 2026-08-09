---
sidebar_position: 6
title: Element catalog
description: Every built-in element you can drop on the canvas, grouped by the categories in the ELEMENTS drawer.
---

# Element catalog

These are the built-in elements in the **ELEMENTS** drawer, grouped by the categories the
drawer uses. Every one of them ships with a **preset** — dropping it gives you an element
that already has content in it, not an empty box you have to fill before you can see it.

Elements from installed plugins appear under their own groups (**Marketplace**, **Your
components**) and are not listed here.

:::tip
Anything on this page can be styled from the **Styles** panel, targeted by
[interactions](interactions-and-custom-html.md), and made
[responsive per breakpoint](responsive-styling.md). The attributes below are the
element-specific settings in the **Attributes** panel.
:::

## Layout

| Element | What it's for |
| --- | --- |
| **Box** | The plain container. No styling of its own — you give it padding, background and borders from the Styles panel. Renders as `div`, `span`, `p`, `figure`, `figcaption`, `blockquote` or `pre`. For landmarks, use **Section** instead. |
| **Section** | Grouping inside a semantic HTML element (`section`, `article`, `aside`, `nav`, `header`, `footer`, `main`) with an accessible label, so the page keeps a meaningful document outline. |
| **Container** | Centres content and caps its maximum width. |
| **Stack** | One-dimensional row or column with a gap. Also the element that carries **repeat over a dataset**. |
| **Grid** | Responsive 12-column layout. See [Grid](#grid) below. |
| **Layout slot** | Where a bound layout injects the screen's own content. |

### Grid

Grid does both jobs in one element, matching Material UI's current API:

- Turn **Container** on for the row. It gets **Spacing**, **Row spacing**, **Column
  spacing** and **Columns** (the row is divided into 12 by default).
- Leave **Container** off for a cell, and give it a **Span**.

**Span** and **Offset** are typed as text so one field covers every breakpoint:

| You type | You get |
| --- | --- |
| `6` | Half the row at every size |
| `auto` | Just wide enough for the content |
| `grow` | All the space the other cells don't take (Span only) |
| `xs:12 md:4` | Full width on mobile, a third from `md` up |

Breakpoint keys are `xs`, `sm`, `md`, `lg` and `xl`; `xs:12, md:4` with commas works too.
If part of what you type can't be read, the whole value is ignored rather than half-applied
— a layout that silently differs from what you typed is worse than one that plainly
doesn't work.

## Surface

| Element | What it's for |
| --- | --- |
| **Paper** | A themed surface. **Elevation** 0–24 raises it with a shadow; the **Outlined** variant swaps the shadow for a border (and hides the elevation control, which does nothing there). |
| **Card** | A surface for one subject, composed from **Card Header** (title + subheader), **Card Content** (the padded body) and **Card Actions** (the button row). Each piece is its own element, so you can select, style and reorder them. |
| **Accordion** | A header that expands to reveal its details, built from **Accordion Summary** and **Accordion Details**. See [Accordion](#accordion) below. |

### Accordion

**Start expanded** controls whether visitors arrive with the panel open. On the **canvas**
the panel is always shown open regardless — collapsed details can't be selected or styled.
**Preview** and the published site both behave the way you configured it, so what ships is
never in doubt.

**Accordion Summary** takes an optional **Header links to**. Leave it empty and the whole
header row toggles the panel, which is what every accordion does by default. Point it at a
screen and the row splits in two: the header text becomes a link to that screen, and the
chevron beside it becomes the toggle. That split is the only way a header can do both — a
link placed inside the toggle button is invalid markup and unreachable by keyboard. It is
what lets a mobile drawer offer *Product* both as a group to open and as a page to visit.

The **FAQ** preset drops three complete panels at once.

## Navigation

| Element | What it's for |
| --- | --- |
| **Screen Link** | A link that targets a screen by id, so it survives slug renames. Renders as a button or as a text link. |
| **App bar** / **Toolbar** | The site header frame. |
| **Nav menu** / **Mega menu** | Dropdown and full-width navigation menus. |
| **Drawer** / **Menu Button** | A panel that slides in from the **left, right, top or bottom**. Open it with a Menu Button or an interaction. **Width** applies to left/right drawers; top and bottom sheets span the viewport, and the control is hidden for them. The **Mobile Nav** preset wires a hamburger, a drawer and a desktop link row in one insert. |
| **Tabs** / **Tab Panel** | A tab strip and its panels. See [Tabs](#tabs) below. |
| **Breadcrumbs** | The trail showing where a page sits. Fill it with Screen Links so it survives renames, and leave the **current** page as plain Typography — linking a page to itself is the classic breadcrumb mistake. Set **Collapse above** to fold a long trail into an ellipsis. |
| **Pagination** | A page picker. See [Pagination](#pagination) below. |
| **Language switcher** / **Theme mode switcher** | Locale and light/dark controls. |
| **Table of Contents** | An "On this page" list built from the headings of a [Markdown](long-form-markdown.md) element on the same screen. |

### Tabs

Type the tab names into **Tabs**, one per line. Then each **Tab Panel** child names the tab
it belongs to in **Shows under tab** (capitalisation and surrounding spaces are ignored).

Panels are matched by **label, not by position**, so reordering them in the hierarchy
never shuffles your content. The preset ships three tabs with three matching panels, so
you only touch the matching if you add a panel yourself.

On the **canvas** every panel is shown stacked, each captioned with the tab it belongs to
— a hidden panel can't be edited, and a caption with a name you don't recognise is a
label typo you can see. Preview and the published site show one at a time.

#### Tabs that go to another screen

A row like **Blog · Changelog · Newsroom** isn't really a tab strip — it's navigation
between three separate screens. Give a tab a screen and it becomes one: pick the target in
**Tab 1 link**, **Tab 2 link** and so on. A picker appears for each tab you've named, up
to the first eight. Those tabs render as real links — a visitor can ⌘-click or middle-click
one into a new tab, and search engines follow them — and they stop switching panels.

Leave the link **unset** for the tab of the page the row is already on — a page that links
to itself helps nobody. The **first** tab with no link is the one the row opens on and
marks as the current page, so give that tab the name of the screen you're placing the row
on. Mixing the two is fine: unlinked tabs keep revealing their own Tab Panel.

Link **every** tab and there is no current one to mark: the row renders with no indicator.
That's the signal you've linked the tab you're standing on. A tab pointing at a screen
that has since been deleted goes inert — no link, and no panel either — so re-point it
after you remove a screen.

As soon as one tab has a link the whole row is marked up as **navigation** rather than as a
tab list, which is what it now is. Give it a name in **Accessible label** so it doesn't
land in a screen reader's landmark list as another "Tabs".

### Pagination

Pagination renders the control and highlights the page a visitor picks. It does **not** by
itself change what the rest of the page shows — wire an
[interaction](interactions-and-custom-html.md) to it for that.

## Text

| Element | What it's for |
| --- | --- |
| **Typography** | One run of text — a headline, a label, a paragraph. The element you [edit inline on the canvas](text-editing.md). |
| **Markdown** | A whole document, held as markdown source in one element. For policies, terms and anything whose real source is a `.md` file. See [Long documents in markdown](long-form-markdown.md). |
| **Entry Body** | A content entry's markdown body, on an entry-template screen. |

## Data Display

| Element | What it's for |
| --- | --- |
| **List** | A vertical list. Optional sticky **Heading**, plus **Dense** and **Disable padding**. |
| **List Item** | One row, with **Divider**, **Align items**, **Dense**, **Disable gutters** and **Disable padding**. |
| **List Item Text** | Primary and secondary text, plus **Inset** to line the text up with rows that have an icon or avatar. |
| **Collection entries** and friends | Content collections — entry lists, bodies, related posts, share bars. |
| **Custom HTML** | Sanitized markup you supply. |

## Media

| Element | What it's for |
| --- | --- |
| **Image** | An image with fit, size and radius controls, an optional link, and an automatic responsive `srcSet` for media-library URLs. |
| **Video** | Hosted or embedded video. |
| **Icon** | Any icon from the icon picker. |
| **Image List** / **Image List Item** | A dense gallery. See [Image List](#image-list) below. |

### Image List

Pick a **Variant**:

- **Standard** — a plain grid.
- **Quilted** — tiles can span several columns and rows. Set **Column span** / **Row span**
  on the tiles; only this variant reads them.
- **Masonry** — every image keeps its own aspect ratio. **Row height** is ignored here (and
  hidden), because a fixed height would crop exactly what masonry exists to preserve.
- **Woven** — alternating tile sizes.

Each tile holds an ordinary **Image** element, so galleries get the same responsive
`srcSet` and lazy loading as an image anywhere else. Fill in **Caption** for a caption bar,
or leave it blank for no bar at all.

## Forms, Input, Commerce, Members

Forms and fields, buttons and widgets, product grids and cart companions, and the
member sign-in/sign-up elements. These are covered with the features they belong to —
see [Forms](../../content-and-data/forms/overview.md),
[Commerce](../../commerce-and-bookings/commerce/overview.md) and
[Member accounts](../../guides/member-accounts.md).

## Related

- [The Besigner](overview.md)
- [Drag-and-drop hierarchy](drag-drop-hierarchy.md) — which elements accept which children
- [Long documents in markdown](long-form-markdown.md) — the Markdown and Table of contents elements
- [Responsive styling](responsive-styling.md)
- [Interactions & custom HTML](interactions-and-custom-html.md)
