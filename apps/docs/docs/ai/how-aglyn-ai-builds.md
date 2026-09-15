---
sidebar_position: 1
title: How Aglyn AI builds
description: The building rules every AI build follows (reuse, components, layouts, forms, theme tokens, drafts only and a measured size) and what happens when an answer breaks one.
---

# How Aglyn AI builds

When Aglyn AI builds for your site (a page, a component, a layout, a form or an
email), it builds the way a careful designer on your team would: from what the
site already has, with your theme and brand, as a draft you review. The rules
below are not a suggestion in a prompt. Every plan and every generated document
is checked against them before you see it.

:::info Availability
Aglyn AI build jobs are released gradually. The rules on this page apply to every
build as it reaches your workspace.
:::

## The plan comes first

Before it generates anything, a build job proposes a **plan**:

- what it will **reuse** from your site: components, layouts, templates, forms,
  datasets and collections;
- what it will **create**, and why nothing you already have will do;
- the **screens** it will build, each with its layout, address, search title and
  sections.

The job then waits for you. Open **AI jobs** in the Assist panel, read the plan,
and choose **Confirm plan** to build it, or **Cancel** to stop. Nothing is
generated until you confirm.

## The building rules

1. **Repeats become one reusable component.** A block that appears three or more
   times on a page, such as the same card with different words, is built once as
   a reusable component and placed as instances. The AI looks for a component you
   already have first, and never makes a second copy of one.
2. **Site-wide regions live in the layout.** Headers, navigation, footers,
   announcement bars and cookie notices belong to the site's layout. A generated
   page sits in your layout and never carries its own copy of them.
3. **Forms are built on the Forms page, then placed.** A form is created with its
   fields, validation, consent and routing on the Forms page, and a page places it
   by reference, so you edit it in one place.
4. **Similar pages share one template.** Pages that share a structure and differ by
   content, such as products, locations, team members or services, are built from
   one template or bound to a collection.
5. **Colors, spacing and type come from your theme.** Generated content uses your
   theme's colors, spacing scale and text styles, never a fixed color value. A
   color your theme lacks is proposed as a theme change for you to review.
6. **Emails use your brand.** Email designs use your brand's colors and fonts, and
   campaigns start from an email template.
7. **Reuse before creating.** Creating something new is the exception, and the plan
   says why.
8. **Data is bound, not typed.** A list you already keep as a dataset, collection
   or product catalog is bound to it rather than typed into the page, so it stays
   current. A long list your site does not have yet becomes a proposed dataset.
9. **Images come from your media library, with alt text.** Images are placed from
   the media library, or left as an empty slot for you to fill, and never linked
   from another website. Every image has alt text or is marked decorative.
10. **Navigation and SEO travel with a page.** Every new screen gets its own
    address, a search title and description, and a navigation entry when the brief
    calls for one.
11. **One main landmark and an ordered outline.** Every page has one main content
    area, one top-level heading, and headings that step down in order, so it reads
    well to screen readers and search engines.
12. **Responsive by your theme's breakpoints.** Widths follow your theme's
    breakpoints instead of fixed sizes, so pages hold up on phones, tablets and
    desktops.
13. **Drafts only.** Everything the AI builds is a new draft. It never publishes,
    and never changes a live page in place.
14. **Your voice, with no filler.** Copy follows your site's tone and the brief,
    with no lorem ipsum. Where the brief leaves out a fact, such as a phone number
    or a price, the AI marks the gap in square brackets instead of inventing it.
15. **Start from a duplicate of the nearest thing.** When your site has a similar
    screen, template or email, the job starts from a copy of it, which keeps its
    bindings and SEO.
16. **The smallest document that does the job.** Generated pages use the fewest
    elements that render the design: no empty or doubled-up containers, text as
    text, images that load as they are reached, video that plays on click, and no
    fonts or third-party embeds you did not ask for.
17. **A measured size for every output.** Each page, component, layout, form and
    email is measured (elements, stored size, image weight, embeds and fonts)
    against a budget for its kind, and an email is kept under the size mail apps
    clip. A job shows a page's estimated first-visit weight before you apply it.

## When an answer breaks a rule

A plan or document that breaks a rule is not used. The AI is asked once more and
told which rules it broke. If the second answer still breaks one, the job stops
and shows you which rules. Choose **Try again** to ask once more, or cancel the
job. Every answer counts toward your AI usage, including the ones that were not
used.

## Who can use it

Build jobs need the **Generate with AI** permission. See
[who can use AI assist](../marketing-and-automation/ai-assist/overview.md#who-can-use-it).

## Related

- [AI Assist](../marketing-and-automation/ai-assist/overview.md)
- [AI Generate Section](../marketing-and-automation/ai-assist/generate-section.md)
