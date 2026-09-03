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

## Finding the one you want {#finding-an-element}

You do not have to recognize an element by name. Two places offer them — the
**Elements** tab beside Hierarchy, and the **Choose element** dialog — and both
search and describe them the same way.

### Search {#element-search}

Type in **Search elements** and the categories collapse into a single **Best matches**
list. Searching looks at more than the name: an element's description, its category
and its keywords all count, so *"space"* finds Stack and *"sign in"* finds the member
elements even though neither says so in its title.

Matches on the **name** always come first — an exact name, then a name starting with
what you typed, then a name containing it — and only after those, elements matched on
their description or keywords. So typing `grid` puts **Grid** at the top rather than
burying it under everything whose description happens to mention a grid. Clearing the
box brings the curated categories back.

![The Elements panel searched for "grid", showing a single Best matches list with Grid first and elements matched on their description below it](/img/besigner/element-search-best-matches.png)

### What an element says about itself {#element-detail}

Point at an element and a detail view explains it before you commit to it:

- **A live preview** — the element genuinely rendered, with its preset content and
  **your site's theme**, so the colors and type are the ones you will actually get.
  It is a picture, not a playground: nothing in it is clickable.
- **What it is for**, in a sentence — written per element rather than generated, so it
  tells you when to reach for this one instead of the similar one next to it.
- **What it will and won't do** — whether it holds other elements, which children it
  accepts, whether it must sit inside something else, whether its text is edited on
  the canvas, and which plugin provides it.
- **Its attributes**, and a **Learn more** link into this page at the right category.

Some elements have nothing to show on their own — a table row, a tab panel — and say
so, naming the parent they belong inside rather than showing you an empty box.

:::note A category you cannot see
The element list only offers what this site can actually use. If a plugin is switched
off for the site, its category is not shown — and searching will not bring it back,
because the search runs over what is on offer. The **Members** elements are the common
case: they appear once [User accounts](../../guides/member-accounts.md) are turned on
for the site.
:::

## Layout

| Element | What it's for |
| --- | --- |
| **Box** | The plain container. No styling of its own — you give it padding, background and borders from the Styles panel. Renders as `div`, `span`, `p`, `figure`, `figcaption`, `blockquote` or `pre`. For a landmark that needs an accessible name, use **Section**. |
| **Section** | Grouping inside a semantic HTML element (`section`, `article`, `aside`, `nav`, `header`, `footer`) with an accessible label, so the page keeps a meaningful document outline. `main` is not on the list — see [The page's `main` landmark](#the-pages-main-landmark). |
| **Container** | Centers content and caps its maximum width. |
| **Stack** | One-dimensional row or column with a gap. Also the element that carries **repeat over a dataset**. |
| **Grid** | Responsive 12-column layout. See [Grid](#grid) below. |
| **Layout slot** | Where a bound layout injects the screen's own content. Its **Component** is `main` unless you change it — see below. |

### The page's `main` landmark

Every published page carries exactly one `main` element: the landmark assistive tech uses
to skip past the nav straight to the content, and the target a "skip to content" link
needs. You don't have to place it, and you can't accidentally end up with two.

It goes on the page's content region, which the platform works out for you:

- On a screen framed by a **shared layout**, the layout's **Layout slot** — everything
  between the chrome. The site nav and the site footer stay outside it, which is the
  whole point of the landmark.
- On a screen with **no layout**, the **Document** layer at the top of the hierarchy.

Both of those have a **Component** attribute if you want to say otherwise. Set the
Document layer to `main` and the slot steps aside; set the slot to `section` (for a layout
whose slot genuinely isn't the page's main content) and the Document layer takes it
instead. Choose something other than `main` in both places and the page ships without one
— your call, deliberately made.

Nothing else can claim it: neither **Section**'s element picker, nor a
**Reusable component** placement, nor [custom HTML](interactions-and-custom-html.md) will
emit a `main`, because a second one makes the landmark ambiguous, which is worse than
having none.

### Every container can be a semantic element

**Stack**, **Container**, **Grid**, **Paper**, **Card**, **Toolbar Content** and
**App Bar** each have a **Component** attribute offering `div`, `section`, `article`,
`aside`, `nav`, `header` and `footer`. So the row that holds your nav links can *be* the
`nav`, rather than being wrapped in one more element to say so.

Leave it unset and the element keeps its own default — an App Bar stays a `header`, a
Stack stays a `div`. Only **Section** also gives the region an accessible name, which a
page with several landmarks of the same kind needs, so reach for Section when you have
two navs or two asides and for the picker when you have one.

`main` is on none of these lists; see below.

### `header` and `footer` for your site chrome

`main` is only half the picture: assistive tech and search engines also look for the
banner and contentinfo regions around it. Those are yours to place.

- A **Reusable component** placement renders as the component's own root element — the
  placement adds nothing of its own to the page. To make one placement a landmark, use
  **Attribute overrides → Component root → Component** on it: set the nav's to `header`
  and the footer's to `footer`, and the published page carries both landmarks around the
  slot's `main`, without a wrapper between them.
- A **Section** anywhere inside a page can be `header` or `footer` too, and adds an
  accessible label with it. So can any of the containers listed above, without the label.
- The **Document** layer takes the same list, for a document that _is_ one region — a
  layout that is nothing but chrome, say. Picking a landmark other than `main` there
  leaves the page without a `main`, as above.

Set the element in one place, not on several nested inside each other: a `footer`
Section inside a `footer` Section is two contentinfo regions where you meant one.

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
| **App bar** / **Toolbar Content** | The site header frame. The app bar is the band; **Toolbar Content** is the row inside it that holds the brand, the links and the actions, and it may only be dropped into an app bar. |
| **Nav menu** / **Mega menu** | Dropdown and full-width navigation menus. |
| **Drawer** / **Menu Button** | A panel that slides in from the **left, right, top or bottom**. Open it with a Menu Button or an interaction. **Width** applies to left/right drawers; top and bottom sheets span the viewport, and the control is hidden for them. The **Mobile Nav** preset wires a hamburger, a drawer and a desktop link row in one insert. |
| **Tabs** / **Tab Panel** | A tab strip and its panels. See [Tabs](#tabs) below. |
| **Breadcrumbs** | The trail showing where a page sits. Fill it with Screen Links so it survives renames, and leave the **current** page as plain Typography — linking a page to itself is the classic breadcrumb mistake. Set **Collapse above** to fold a long trail into an ellipsis. |
| **Pagination** | A page picker. See [Pagination](#pagination) below. |
| **Language switcher** / **Theme mode switcher** | Locale and light/dark controls. |
| **Table of Contents** | An "On this page" list built from the headings of a [Markdown](long-form-markdown.md) element on the same screen. |

### Where a link opens

**Screen Link** and **Button** both carry an **Open link in** dropdown once they point at
a screen or a URL:

- **Same tab** — the default, and what you want for navigation inside your own site. The
  visitor keeps their back button and their history.
- **New tab** — for a download, a PDF, or an outside site you want them to come back
  from. Whether the browser makes that a tab or a window is the visitor's own setting, not
  something the page gets to decide.
- **Custom window name** — reveals a **Window name** box. Every link sharing a name reuses
  that one window instead of opening another, so a set of links can drive a single
  companion window. Leave the box empty and the link behaves as **Same tab**.

Links that open elsewhere are marked up so the new page can't reach back into the one it
came from. **Link Container** has the same choice as a simple **Open in a new tab**
switch, which applies to external destinations only.

### Tabs

Type the tab names into **Tabs**, one per line. Then each **Tab Panel** child names the tab
it belongs to in **Shows under tab** (capitalisation and surrounding spaces are ignored).

Panels are matched by **label, not by position**, so reordering them in the hierarchy
never shuffles your content. The preset ships three tabs with three matching panels, so
you only touch the matching if you add a panel yourself.

On the **canvas** every panel is shown stacked, each captioned with the tab it belongs to
— a hidden panel can't be edited, and a caption with a name you don't recognize is a
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

One element in this group belongs to neither:

| Element | What it's for |
| --- | --- |
| **Function Widget** | Runs one of your no-code [functions](../../marketing-and-automation/workflows-and-actions/overview.md) on the live site and shows what it returns — a quote calculator, a shipping estimate, a score. **Function name** is the function from the site's Functions card; the widget draws an input per parameter, a run button you can relabel, and the result under a **Result label** prefix. The function runs server-side, so its logic is never in the page source. |

## Related

- [The Besigner](overview.md)
- [Drag-and-drop hierarchy](drag-drop-hierarchy.md) — which elements accept which children
- [Long documents in markdown](long-form-markdown.md) — the Markdown and Table of contents elements
- [Responsive styling](responsive-styling.md)
- [Interactions & custom HTML](interactions-and-custom-html.md)
