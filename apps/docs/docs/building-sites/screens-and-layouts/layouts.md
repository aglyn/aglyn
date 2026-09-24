---
sidebar_position: 3
title: Layouts
description: A layout is the shared frame your screens render inside — header, nav and footer in one place, nested up to five deep.
---

# Layouts

A **layout** is the shared frame a screen renders inside. It is not a page of its own and
never has a URL: it has a **slot**, and whatever screen you bind to it renders in that
slot. For the pages themselves, see [Screens](screens.md).

:::info Plan availability
**Free.** Every plan can create layouts and nest them.
:::

## What a layout is

A layout holds the furniture many screens have in common — header, navigation, footer,
a cookie banner, a site-wide search box. Bind a screen to a layout in the Besigner and
the layout chrome wraps the screen both in the editor and on the published site.

Because the chrome lives in one document, changing it changes every screen bound to it at
once. That is the point, and it is also the thing to keep in mind before you publish: see
[Versions & scheduled publishing](versions-and-publishing.md).

## Find a layout {#find-a-layout}

The site's **Layouts** page lists every layout. **Filters** in the table's toolbar
narrows it by display name, ID, description, or the date it was created or last
updated, and **Search** matches any word of the name, ID, or description. Each filter in
force shows as a chip above the table; remove a chip to drop it. The list pages as you
go, so a filter looks through the layouts read so far and reads further as you page on;
the table says so while more remain.

## Nested layouts

A layout can render inside **another layout**. Set **Renders inside** on a layout's detail
page and its chrome is wrapped by the outer layout's, exactly as a screen is wrapped by
its own — so site-wide furniture can live in one place while a section keeps a more
specific frame around it.

A screen inherits the whole chain: bind it to the inner layout and it renders inside that,
which renders inside the outer one, up to five layouts deep.

A layout can never sit inside itself, or inside a layout already nested within it — that
would be a loop with no outermost frame to render. The picker only offers layouts that
are legal choices, so you cannot select one by mistake.

## Layout properties

A layout can take **properties**, the way a
[reusable component](../besigner/reusable-components.md#properties) does, so one frame can
differ from screen to screen — a banner one screen shows and another hides, a call to action
worded per page — without a second layout.

1. Open the layout in the Besigner and choose **File ▸ Properties…**
2. **Add property**. Every property type a reusable component offers is here, with its
   default, help, settings and condition set with the same controls.
3. Inside the layout, put the property's token — `{{prop.bannerText}}` — in any text or
   string attribute, or bind a field to it with the field's `{}` button: a switch to a
   Yes / no, an icon picker to an Icon. **Hide when** and **Hide unless** take a property
   too, so a screen can remove part of the layout's chrome.

Each screen sets the values in **Screen Properties**, under **Shared layout**, below the
**Layout** picker: one field per property, drawn with the control its type names. Leave a
field empty and the layout's default renders. **Save layout values** stores them on the
screen version being edited, beside its layout binding, so publishing that version publishes
its values with it.

Values are kept per layout. Binding a screen to a different layout starts from that
layout's defaults, and a screen inside nested layouts sets each layout's properties
separately.

Properties saved on the layout's published version reach live screens straight away — that
version is what they render. On any other version they go live when you publish it.

Pages the site builds without a screen of their own — search results, author pages, and a
collection with no template screen — render inside the site's built-in page layout with its
properties' defaults.

## Restyle the layout on one page

A screen can change how the layout's elements **look** on that page alone: a transparent
nav over this page's hero, a different footer background on a landing page. The layout's
content stays the layout's, and every other screen using it keeps the layout's own styling.

1. Open the screen in the Besigner. The banner above the canvas names the shared layout that
   frames it.
2. Choose **Style the layout on this page** and pick an element. The list follows the
   layout's hierarchy, and a dot marks each element this page already restyles.
3. The **Styles** tab opens on that element, marked **Styles only**, and says *Styling the
   layout's … on this page only.* Every control works as it does on the page's own
   elements, including breakpoints, the dark scheme and hover states. Each property you
   change is listed as a chip: its ✕ returns that property to the layout's value, and
   **Reset** clears them all.
4. Save or publish the screen as usual. The styling is part of the screen version, so it
   is undoable, kept in a saved draft, and goes live when that version does.

The **Attributes** tab points you to the layout for anything else: an element's text, links
and settings are edited in the layout itself (**Edit layout**). Select any element on the
page to leave this mode.

If the layout is later edited and an element you restyled is removed, that styling is simply
ignored. A reusable component the layout places, such as a site nav, can be restyled the
same way: the change applies to its outer element.

## Duplicate

**Duplicate…** in a layout's row menu (and under **More** on its detail page)
makes a second layout with the same element tree and properties as the latest
saved version, named `Copy of <layout>` unless you type another name. No
screen uses the copy until you assign it, so nothing on the live site changes.
The copy counts against your shared-layout allowance like a new layout.

## Generate a layout with Aglyn AI

An AI build job can make a layout from a brief: the header, navigation and footer you have in
mind. The job proposes a plan first, and builds once you confirm it: a header that links your
screens, the slot each page renders in, and a footer. When your site already has a navigation
or menu component, the layout places it rather than building another. The layout follows
[the building rules](../../ai/how-aglyn-ai-builds.md), so it carries no page title of its own
and takes its colors and type from your theme.

Open **Layouts** for the site and choose **Describe it**, beside **Templates** and **Create New
Layout**. Write what the header, navigation and footer should hold, then choose **Plan the
layout**, and open **AI jobs** in the Assist panel to read the plan and confirm it.

A link in the layout goes only to a screen that does what its words say, and one on a colored
band, such as a footer in your primary color, uses the band's text color. Where the brief leaves
out a fact, such as your address or opening hours, the footer marks it in square brackets, and
**AI jobs** lists those gaps beside the draft.

The layout arrives as a new draft in **Layouts**, and **Open draft** on the job opens it in the
Besigner. No screen uses it until you assign it, so nothing on the live site changes. It counts
against your shared-layout allowance like a layout you create yourself, and when the site has
none to spare the job says so before it starts, not after it has spent anything.

## Used by

A layout's detail page has a **Used by** card listing everything that renders inside it,
so you can see what a change or a deletion would reach:

- **screens** bound to it, published or not, and
- **layouts nested inside it** — deleting the outer one unwraps every screen underneath
  those too.

A layout used by neither is genuinely unused.

## Layouts vs. reusable components

Both let you build something once and use it in many places, and they are not
interchangeable:

| | Layout | [Reusable component](../besigner/reusable-components.md) |
| --- | --- | --- |
| What it is | A frame with a slot | A subtree you insert as an instance |
| How a screen uses it | Binds to it; the layout wraps the screen | Inserts one or more instances anywhere in its own tree |
| How many per screen | One chain, outermost first | As many instances as you like |
| Where properties are set | Screen Properties, per screen | The Attributes panel, per instance |
| Good for | Header, nav, footer, site chrome | A card, a call-to-action, a pricing block |

If the thing wraps your content, it is a layout. If the thing *is* content you want to
repeat, it is a reusable component.

## Related

- [Screens](screens.md)
- [Versions & scheduled publishing](versions-and-publishing.md)
- [Reusable components](../besigner/reusable-components.md)
- [Menus & navigation](../menus-and-navigation/overview.md)
