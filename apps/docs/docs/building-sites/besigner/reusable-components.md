---
sidebar_position: 5
title: Reusable components
description: Promote a subtree into a reusable component, give it properties, and insert instances across screens.
---

# Reusable components

Build something once — a card, a call-to-action, a footer block — and reuse it everywhere as
a **reusable component**.

An instance is not a copy. It **grafts the source at render time**, so editing the component
updates every page that places it. Change a font size once and the whole site follows.

A component is content you repeat **inside** a page. If what you want is the frame
*around* the page — header, navigation, footer — that is a
[layout](../screens-and-layouts/layouts.md), not a component. And if you want a starting
point you copy once, with no live link back to the source, that is a
[template](../site-templates/templates-library.md).

:::info Plan availability
**Starter and above.** On Free, promoting an element answers *"Reusable components
require a Starter plan — see Billing to upgrade."* There is no cap on how many
components a site can have.
:::

![The site's reusable components page](/img/besigner/components-page.png)

## Promote

1. Select the element you want to reuse. The whole subtree comes with it.
2. In the **Attributes** panel, choose **Save as reusable component**.
3. Give it a name and an optional description, then **Save component**.

The element you promoted **becomes the first instance** of the new component, in place. It
keeps its position in the page and its element id, so the parent's child list, your undo
history and the current selection all stay valid.

That in-place swap is the point. If promoting left the original behind as ordinary
elements, the document that defined the component would be the one place that never
tracked it — you would edit the component later and this page alone would silently keep the
old copy.

:::note
**Save as reusable component** appears only on an element that is not already an instance
and is not locked by a shared layout. Elements a layout frames are locked on the screens
that use it — open the layout to promote from there.
:::

## Insert instances

Insert instances from **Your components** in the element drawer, on any screen, layout,
template or other component.

On the canvas an instance **renders its actual content**, not a placeholder — what you see
is what the page will render, with properties already resolved. The rendered elements are
not canvas elements, though: clicking anywhere on an instance selects **the instance**,
which is the only thing there you can select, move or delete. To change what is inside it,
open the component.

![An instance rendering its content on the besigner canvas](/img/besigner/component-instance-on-canvas.png)

## Properties

A component doesn't have to look identical everywhere. Give it **properties** and each place
you use it supplies its own text, image, link, color or choice — while the layout and the
styling still come from the one component.

This is what stops a hero from being rebuilt on every page. Only the differences vary.

### Declare them

1. Open the component and choose **File ▸ Properties…**
2. **Add property**. Give it a name — `headline`, say — a type, an optional label for the
   Attributes panel, optional help, and a **default**.
3. The dialog shows each property's token under its name.

![The Component properties dialog with two properties declared](/img/besigner/component-properties-dialog.png)

Every field a built-in element offers in the Attributes panel is a property type, listed in
the **Type** picker by group:

| Group | Types |
| -- | -- |
| Text | Text · Long text · Formatted document · Table |
| Media and links | Image · Link · Icon |
| Numbers | Number · Slider |
| Choices | Yes / no · Checkbox · Choice · Radio buttons · Toggle buttons · Pick list |
| Style | Color · Size · Border · Background fill · Column span · Theme preset · Theme scale |
| Date and time | Date · Time |
| Site content | Element on the page · Product · Collection · Category · Dataset · Dataset field · Form · Plugin · Plugin settings |

A property is edited with the control that field has on a built-in element, in the dialog's
**Default** and on every page that places the component: **Yes / no** is a switch, **Icon**
is the icon picker, **Color** is the color and theme-token picker, **Size** is a number with
a unit, **Product** lists the site's products, and so on.

Some types need a setting before they can be drawn, shown under the property's row:

- **Slider** — the lowest value, the highest value and the step.
- **Choice** — whether a page can pick several answers.
- **Theme scale** — which of the theme's scales it offers: font sizes, font weights or
  stacking layers. **Theme preset** — which presets: corner radius, shadow, font family,
  text style or gap.
- **Dataset field** — the dataset whose fields it lists; leave it empty to list the fields
  of the dataset the placed component sits inside.
- **Plugin settings** — the **Plugin** property whose chosen plugin the settings are for.

A **Choice**, **Radio buttons**, **Toggle buttons** or **Pick list** property lists its
answers under its row: **Add choice**, then give each one a **Label**, which is what a page
picks, and a **Value**, which is what the field bound to the property receives. Bound to a
dropdown, the values must be ones that dropdown offers; the Attributes panel lists them if
one is missing. A **Checkbox** with no answers is a single tick box; given answers, it is a
list a page ticks several of.

A **Link** property is a target picker at both ends — in the dialog's **Default** column and
in each instance's Attributes panel — exactly like a Button's own **Link to screen** field.
It stores the target's id, not its address, so the link keeps working when a slug or parent
changes. Type in it and it searches four kinds of target: your pages, each content
collection's listing page (**Blog (/blog) — collection listing**), their RSS feeds, and the
entries themselves (**Hello (/blog/hello) — Blog entry · published**). Whichever you pick,
the link follows that target through a rename — see
[Linking to a listing, an entry, or a feed](element-catalog.md#linking-to-a-collection-listing).
Choose **External URL or path…** for anything that is none of them; a typed address is used
verbatim and does not follow a rename.

Link properties written before the picker existed hold a typed address. They keep working
unchanged — but they are still typed addresses, so pick the screen again if you want them to
survive a rename.

**Help** is shown beside the property's field wherever a page sets it.

Property names must start with a letter or underscore and contain only letters, numbers and
underscores. A dot is rejected: the Attributes panel names its field for the storage path
`propValues.<name>`, which splits on dots, so `hero.title` would address a level that does
not exist and its value would silently never reach the page.

### Make a property conditional

A property can apply only when other properties meet a condition — a call-to-action label
that only matters while **Show call to action** is on, say. Under the property's row,
**Add condition**, then build each rule from a property, an operator and a value:

- **is** / **is not** — the value is edited with that property's own control, so a Yes / no
  rule is a switch and a Choice rule a dropdown of its answers.
- **is one of** / **is none of** — for a property with answers.
- **is empty** / **is not empty**.
- **is more than**, **is at least**, **is less than**, **is at most** — for a Number or Slider.
- **matches the pattern** / **does not match the pattern** — a regular expression, up to 500
  characters. Lookahead and lookbehind, backreferences, named groups and Unicode property
  escapes are not supported, and the dialog says so when a pattern uses one. A pattern that
  reaches a component some other way and cannot be matched counts as a rule that does not
  hold, as does any pattern tested against a value longer than 2,000 characters.

With more than one rule, choose whether **all** of them or **any** of them must hold. A rule
compares what each property is worth on the page: the page's own value, or its default when
the page set none.

While the condition does not hold, the property's field is hidden in the Attributes panel,
and the property renders as though it had no value and no default: text bound to it is
empty, a Yes / no is **No**, and a field bound to it keeps the element's own default. A value
the page already set is kept, and applies again when the condition does.

### Use them

Inside the component, put the property's token wherever the value belongs:

```
{{prop.headline}}
```

It works in any text element and in any string attribute — the same token syntax as
`{{entry.*}}` and `{{host.*}}`. The `{}` **insert binding** button beside a bindable field
lists the component's own properties under **Properties**, so you can pick one instead of
typing the token.

A Link property can be bound into either of a linking element's two fields — **Link to
screen** or **External URL** — and resolves the same way in both.

Whatever a page sets on a property bound into an address — a link's **External URL**, an
image's **Image source** — has to be one when the page renders: a web address, a path, a
`mailto:` or `tel:` link, or a screen; for an image, an `https://` address, a path or a
media library pick. Anything else, such as a `javascript:` address, is left off the element,
which renders as though that field were empty.

Fields you do not type into have a `{}` too, beside their help icon, and it lists only the
properties that hold the kind of value that field holds:

| Field | Properties offered |
| -- | -- |
| Switch or a single checkbox | Yes / no, Checkbox |
| Dropdown | Choice, Radio buttons, Toggle buttons |
| Dropdown that takes several answers, checkbox list or pick list | Choice that takes several answers, Checkbox with answers, Pick list |
| Screen picker | Link |
| Icon picker | Icon |
| Slider | Number, Slider |
| Formatted document | Long text, Formatted document |
| Any other field — color, size, border, background fill, column span, theme preset, theme scale, date, time, table, or a site-content picker | The property type of the same name |

Bind a Video's **Open in a lightbox** to a Yes / no property, and each page decides whether
its film opens in a lightbox or plays in place; bind an Image's **Width** to a Size property,
and each page sizes its own picture. A bound field shows the property's name where the
control was; click it to pick a different property or remove the binding.

Each field receives the value its property holds — a real yes or no, a number, a list of
answers, a theme color token — never the same value written as text.

### Save, then publish

**Saving is not publishing.** Live pages read the published component.

1. **Save properties** — the dialog confirms *"Properties saved. Publish to make them
   available on live pages."*
2. **Save draft**, in the toolbar or the File menu, keeps canvas work unpublished. On the
   published version it is a draft stored with the site, offered to whoever opens the
   component next with **Open draft** and **Discard**.
3. **Save & publish**, in the toolbar's save menu or the File menu — *"Published. Every
   screen using this component is refreshing now — you do not need to republish them."*
   If a saved draft is on offer, open or discard it first.

Publishing the component is enough. You do not republish the pages that use it.

### Fill them in per page

Select any instance and the **Attributes** panel has one field per property, drawn with the
control its type names.

![The Attributes panel showing one field per declared property](/img/besigner/component-instance-attributes.png)

The component's default shows as the field's **placeholder**, with the exact default
spelled out underneath. Leave a field empty and that default is what renders — so clearing
a field restores the component's own copy rather than collapsing the section to nothing.

An empty field counts as unset. `0` and **No** are real values and survive. A Yes / no field
is a switch: until the page sets it, the switch sits where the component's default puts it
and says *"Uses the component default (Yes)"*. Once a page has chosen, the ✕ on the field —
on a switch, a dropdown, an icon picker or any other control that has one — hands the
decision back to the component's default.

A conditional property's field appears only while its condition holds for this instance.

Shared layouts take properties the same way, and each screen sets them in Screen
Properties — see [Layout properties](../screens-and-layouts/layouts.md#layout-properties).

### Restyle one instance

Select an instance, open the **Styles** tab, and everything you change applies to
**that placement only** — layered over the component's own styles. Other pages keep the
component look, and component updates still flow through. A chip at the top of the panel
names the mode, and each overridden property lists beside it with an ✕ that returns it to
the component's value.

Styles are per **element inside** the component, not just its outer box. The panel's
**Style target** picker lists the component's own tree — the outer element first, then
each element inside it, indented — and a `•` marks the ones this instance has already
overridden. Pick one and the whole panel styles that element, on this instance.

That picker is what a variant needs. A component's headline usually sets **its own**
color, so a background change on the outer element never reaches it: switching one CTA
to a white band without also targeting the headline gives you white text on white. Set
the background on the outer element, then pick the headline and the sub-copy and set
their colors too.

**Taking off a gradient.** If the component's background is a gradient, setting
*Background Color* on the instance is not enough — `background-image` paints over
`background-color`, so the gradient still wins. Set **Background Fill** to *Solid color*
as well: that records "paint no image" for this placement and your color shows. The
field's first choice, *Inherited*, is the way back — it drops the override and the
component's gradient returns. Overriding to a *different* gradient works the same way.

Styling is all an override does. The **content** of an element inside a component stays
the component's — text and images come from the component or from its
[properties](#properties). If one page needs different words, add a property for the
difference; if it needs a different structure, edit the component (every page follows)
or [detach](#detach) that instance.

Overrides are stored against the component element they target, so an element deleted
from the component later simply drops its override — that instance falls back to the
component's own styling rather than breaking.

:::warning
Instance values are stored **against the property name**, so renaming a property orphans
every value already set against the old one and those pages fall back to the default.
Rename in place rather than deleting and re-adding.
:::

### Override an attribute on one instance

Styles are not the only thing one placement can differ in. Select an instance, open the
**Attributes** tab, and scroll to **Attribute overrides**: an **Override target** picker
listing the same tree the Style target picker does, and under it the attributes of the
element you pick — its variant, size, link, and so on.

Set one and it applies to **that placement only**, layered over the component's own value.
Leave a field empty and the component's value is what renders; the placeholder shows you
what that is. A chip counts what this instance overrides, and each override lists beside it
with an ✕ that hands the attribute back to the component.

This is for the differences that are not worth a property. A property is the right answer
when the difference is *content*, or when the same difference recurs across pages — it is
named, documented and filled in on every instance. An override is for the one-off: this
page's CTA is outlined, everywhere else it stays solid.

**No** and `0` are real overrides and survive; an empty field is not an override at all.

Component updates still flow through an override. An override replaces only the attributes
it names, so an attribute the component **adds** later reaches every instance with the
component's new value, overridden ones included.

Two things are deliberately not overridable here:

- **Content.** `Text` and rich text stay the component's, and come from the component or
  from its [properties](#properties) — the same rule the style overrides follow.
- **Styles**, which have their own layer on the [Styles](#restyle-one-instance) tab. One
  place per kind of change, so the two can never disagree about what an instance looks
  like.

A handful of attributes are not offered per instance either — icon pickers, screen links,
gradients and plugin settings. Change those in the component, or [detach](#detach).

## Retrofit duplicated sections

If the same section has already been copied onto several pages, converting it is safe and
takes one pass:

1. On the page whose wording is correct, **promote** the section. It becomes an instance
   and the definition is created from it.
2. Open the component, declare a property for each part that differs between pages, and
   replace those texts with their tokens. Use the *first* page's wording as each default.
3. **Save properties**, then **publish**.
4. On every other page, insert an instance, check it renders, and only then delete the old
   section. Appending before deleting keeps the page's section order intact when the
   section is the last one.
5. Fill in that page's wording on the instance — or leave the fields empty where the copy
   was already identical.

Deleting last is what makes this reversible: at every point the page still has exactly one
copy of the section.

## Detach

**Detach from component**, on an instance, turns it back into ordinary elements with fresh
ids — the confirmation reads *"Detached — this copy no longer follows the component."*
Use it when one page needs a variation the shared source shouldn't carry.

What you get is what the page was showing. The property values set on that instance — and
every [per-instance style](#restyle-one-instance) and
[attribute override](#override-an-attribute-on-one-instance) applied to it, on its outer
element and on each element inside it — are baked into the copy as ordinary text, images,
styles and attributes,
so the section looks identical before and after; it is simply editable now. Nothing in the
copy still points at a property.

Detach copies the component's **published** tree — unsaved or unpublished edits sitting
in the component's working version are not what you get.

## Nesting

A component can place instances of other components. Expansion runs to a depth of **5**,
which also bounds a component that accidentally references itself.

Nested components expand on the canvas too, not only in Preview and on the live site — so a
shared button inside a shared nav is drawn where you are editing, and publishing that button
updates every open canvas that shows it, however deeply it is nested.

## Used by

A component's detail page has a **Used by** card listing everything that places an instance
of it, so deleting one is not a guess.

Three places are searched, which is everywhere the renderer expands an instance:

- the **published version** of every screen,
- the **published version** of every layout,
- and **other reusable components** — a component can be placed inside another one, so one
  used nowhere else can still be very much in use.

Unpublished drafts and templates in your library are not searched. If the check fails — a
dropped connection, say — the card says so and shows a **Try again** button. It never
reports "nothing uses this" when it could not actually look.

If a component is deleted while instances remain, those instances are left untouched rather
than emptied: a missing definition never takes a published page down.

## Manage

From the site's **Components** page you can **rename**, edit the description, open the
besigner, or **delete** a reusable component. The component's **ID** is persisted inside
every screen that places it and never changes.

You can also give a component its own **icon**, from the same picker the besigner uses for
icon elements — either in the **Edit component** dialog on the Components page, or on the
component's detail page. Every instance is then marked with it: in the hierarchy, on the
canvas badge, and in the element drawer under **Your components**. A page assembled from
promoted sections becomes readable at a glance. Components without an icon keep the
generic package glyph.

## Duplicate

To start a new component from an existing one, choose **Duplicate…** in its
row menu on the Components page, or **More → Duplicate** on its detail page.
The copy carries the definition, its properties and the latest saved version,
under the name you give it. It has no instances: every screen keeps pointing
at the original, and you place the copy where you want it. Duplicating needs
the same plan as creating a component.

## Copy & paste vs. reusable components

| You want | Use |
| -- | -- |
| Another one right here | **Duplicate** |
| The same structure somewhere else, edited separately from then on | **[Copy & paste](copy-paste.md)** |
| One thing that updates everywhere it appears | **Reusable component** |

## Tips

- Reusable components are perfect for anything that repeats across pages — headers, CTAs,
  contact blocks.
- Give a property a default that reads well on its own. A page that sets nothing should
  still look finished.
- Detach when you need a one-off variation that shouldn't affect the shared source.

## Related

- [Copy & paste elements](copy-paste.md)
- [The Besigner](overview.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
- [Generate a reusable component with Aglyn AI](../components/generate-a-component-with-aglyn-ai.md)
