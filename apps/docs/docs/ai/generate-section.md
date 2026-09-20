---
sidebar_position: 5
title: Generate a section on the canvas
description: Describe a section and Aglyn AI builds it from real components, on the page you have open, as an unsaved change you can undo.
---

# Generate a section on the canvas

Where [rewriting copy](copy-assist.md) changes words, **Generate a section with AI**
builds **structure** — a whole section of real components — directly on the page you
have open.

:::caution Rolling out
Generating a section is part of **Aglyn AI**, a release-flagged feature currently being
rolled out — it is not available in every workspace yet. This page says what it does,
and grows with the feature.
:::

## Use it

1. Open a page, layout or reusable component in the Besigner and select where the
   section should go.
2. Choose **Generate a section with AI** on the editor's toolbar.
3. Describe the section — "a three-column features row with icons and short blurbs",
   "a quote from a customer above a button that books a call".
4. Read what comes back, then apply it.

The section arrives as an **unsaved change** on the version you have open. One undo
takes it back, nothing is published, and on the version your live site shows the
Besigner asks you to make a new version first.

## What it builds

The section is built from your site's real components and follows
[the building rules](how-aglyn-ai-builds.md), so it drops into your design rather than
sitting on top of it:

- **Your theme's colors, spacing and text styles**, never a fixed color value.
- **A grid that breaks down**, showing one column on a phone and stepping up on larger
  screens, at your theme's own breakpoints.
- **Headings in order**, so the page still reads well to screen readers and search
  engines.
- **Images from your media library**, each with alt text, or an empty slot for you to
  fill. Never an image linked from another site.
- **A repeat built once.** A block that appears three or more times becomes one
  reusable component placed as instances — or, on a plan without reusable components,
  is built into the page each time.

## Tips

- Generate a rough section, then adjust it with
  [drag-and-drop](../building-sites/besigner/drag-drop-hierarchy.md) and
  [inline text editing](../building-sites/besigner/text-editing.md).
- Mix generated sections with the
  [section & block library](../building-sites/site-templates/overview.md).
- For a whole page rather than one section, start from
  [Generate a page](../building-sites/screens-and-layouts/generate-a-page.md), which
  plans the page first.

## Who can use it

Generating a section needs AI generation on your plan and the **Generate with AI**
permission — see [who can use Aglyn AI](overview.md#who-can-use-it). A site that has
[switched AI off](overview.md#switch-ai-off-for-one-site) shows none of these controls.
Each generation spends AI credits like any other AI request.

## Related

- [Rewrite and write copy with AI](copy-assist.md)
- [How Aglyn AI builds](how-aglyn-ai-builds.md)
- [The Besigner](../building-sites/besigner/overview.md)
