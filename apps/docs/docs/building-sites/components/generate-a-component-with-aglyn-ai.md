---
sidebar_position: 1
title: Generate a reusable component with Aglyn AI
description: Describe a block your site repeats, or point at one already on a page, and Aglyn AI makes it a reusable component with typed properties bound to the elements that show them.
---

# Generate a reusable component with Aglyn AI

Aglyn AI makes a [reusable component](../besigner/reusable-components.md) two ways: from a
brief, such as *"a testimonial card with the customer's name, their role, their quote and a
photo,"* or from a section you already have on a page. Either way you get one component built
the way you would build it yourself: the elements, and a **property** for each value that
changes from one page to the next, already bound to the element that shows it.

:::info Availability
Aglyn AI build jobs are released gradually, and need the **Generate with AI** permission.
Reusable components come with the Starter plan and above: on a plan without them, the job says
so before it starts, and spends nothing.
:::

## From a brief

Open **Components** for the site and choose **Describe it**, beside **Templates** and **Create
Component**. Write what the component should show and which of its values change from one page
to the next, then choose **Plan the component**, and open **AI jobs** in the Assist panel to
read the plan and confirm it.

### What the job builds

The job proposes a plan first and builds once you confirm it, following
[the building rules](../../ai/how-aglyn-ai-builds.md). The plan lists the properties it intends,
such as `quote:richText` or `photo:image`, and the component declares every one of them.

Each property is one of the kinds the **File ▸ Properties…** dialog offers:

| Kind | What it fills |
| -- | -- |
| Text, Long text | Copy: a heading, a paragraph, a button's label, an image's alt text. Copy can mix a property with words, such as `Portrait of {{prop.name}}`. |
| Image | A picture's source. |
| Link | A screen picker, or an address. |
| Icon | An **Icon** element, or a button's icon. |
| Number | A number setting, or copy. |
| Yes / no | A switch, such as a button's **Full width**, or whether an optional part shows. |
| Choice | A dropdown, such as a button's **Variant**, with answers that dropdown lists. |

A property is bound only where its value can show: an Image never lands in a heading, an icon is
never shown as words, and a Choice never offers an answer its dropdown does not list.

A component's headings start one level below the heading of the section that places it, such as
a card's title as a heading 3 under the section's heading 2, so the page's outline stays in order
wherever the component goes. These are the pairings the `{}` beside
a field offers when you bind one yourself.

### Optional parts

A part not every page needs, such as a photo or a second button, gets a **Yes / no** property
labeled **Hide …**, such as **Hide photo**. It starts as **No**, so the part shows until a page
switches it off, and a page that hides it drops the part entirely rather than leaving a gap. The
job never makes a property that hides the whole component.

### Defaults

Each property's default is what the component shows until a page sets its own value. Copy is
written in your site's voice from the brief. Where the brief leaves out a fact, such as a
customer's name, the default marks the gap in square brackets, such as **[Customer name]**,
instead of inventing one. An Image starts empty for you to upload, and a Link names one of your
screens. An Icon starts empty too: you pick each icon from the library, on the component or on each
page that places it, because the AI never picks an icon for you.

### Where it lands

The component arrives as a new draft on your site's **Components** page, and **Open draft** on
the job opens it. Nothing on your site places it until you insert it from **Your components**,
so nothing on the live site changes. It is ready to place as it is: open it in the Besigner to
change its elements or its **File ▸ Properties…**, and publish your changes as you would for
any component.

When the plan starts from a copy of a component you already have, the job makes that copy
instead of generating a new one.

## From a section on your page

A section you have already built and want to reuse does not need describing: select it in the
Besigner and use **Make a reusable component with AI**, under the element's own settings in the
**Attributes** panel. Name the component, and Aglyn AI reads the section and suggests which of
its values each page should be able to change.

The suggestion is shown before anything happens, with what every page will be able to set. The
kinds, the pairings and the **Hide …** rule above are the same ones, except that a section's icon
stays part of the section rather than becoming an **Icon** property.

**Apply** then does what **Save as reusable component** does, with the properties already in
place:

1. the component is saved to your library, with each suggested value replaced by its property;
2. the section on your page is swapped for one that follows the component.

Each property's default is the value that was on the page, so the page looks exactly as it did
a moment before — the section now follows the component instead of being a copy of it. A **Hide
…** property starts as **No**, because the part it hides is on the page.

The swap is an unsaved change on the version you have open, and one undo takes it back. Nothing
is published, and on the version your live site shows, the Besigner asks you to make a new
version first. If the component cannot be saved — a plan without reusable components, for
instance — nothing on your page changes at all.

:::tip Pick the section, not the page
Save the part you want to repeat. Aglyn AI declines a selection that is the whole page, one
carrying the page's main region, or one with more than one top-level heading, because a
component is placed inside pages rather than being one.
:::

## Related

- [Reusable components](../besigner/reusable-components.md)
- [How Aglyn AI builds](../../ai/how-aglyn-ai-builds.md)
