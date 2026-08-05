---
sidebar_position: 10
title: Long documents in markdown
description: Put a whole policy, terms or handbook page on the canvas as one Markdown element, and let a Table of contents element build the "On this page" list from its headings.
---

# Long documents in markdown

Some pages aren't designed — they're written. A privacy policy, terms of service, an
acceptable-use page or a staff handbook is a *document*, and its real source is usually a
markdown file somewhere else: a repo, a Drive folder, whatever your lawyer sends back.

The **Markdown** element puts that document on the canvas as one element, holding the source
text. Updating the page is one paste. The **Table of contents** element reads that same
text and builds the "On this page" list from its headings, so the list can never fall out of
step with the document above it.

:::tip
Building a page out of one Typography element per paragraph is the alternative, and it costs
you the thing that matters most here: you can't copy the page back out to compare it with the
source file, and every heading you add means hand-editing the contents list too.
:::

## The Markdown element

Drop **Markdown** from the **Text** group of the **ELEMENTS** drawer, then paste your document
into the **Content** attribute.

Text is set for reading rather than for a layout: 17px on a generous line height, in the
theme's primary text colour, with headings that step up in size on wider screens. You don't
need to style anything for it to look right.

### What the markdown supports

| You write | You get |
| --- | --- |
| `## A heading` | A top-level heading — and an anchor a contents list can link to |
| `### A sub-heading` | A second-level heading, also anchored |
| `**bold**`, `*italic*` | Bold and italic |
| `[text](https://example.com)` | A link. `/pricing` works too, and navigates without a page reload |
| `- item` | A bullet list (`*` works as well) |
| `![alt](https://…)` | An image |
| ` ```lang ` … ` ``` ` | A fenced code block |
| `\| A \| B \|` … | A pipe table, with `:--`/`:-:`/`--:` alignment |

Blank lines separate blocks. `#` and `####` and deeper are still headings — they fold onto
the two levels above rather than being read as ordinary text, so a document that opens with
a single `# Title` renders the way you'd expect.

Anything the dialect doesn't recognise stays as **words**. That includes HTML: paste
`<script>` into a document and visitors read `<script>`, they don't run it. This isn't a
setting you can turn off — the element never builds an HTML string in the first place, so
there's nothing to escape or trust.

## The Table of contents element

Drop **Table of contents** from the **Navigation** group. On a page with one Markdown
element, that's the whole setup — it finds it and lists its headings.

| Attribute | What it does |
| --- | --- |
| **Markdown element** | Which Markdown element to read. Leave it empty unless the screen has more than one. |
| **Heading** | The label above the list. Defaults to *On this page*; clear it for no label. |
| **Levels** | List `##` and `###` headings, or `##` only. |

Sub-headings are indented under their parents. Each entry is a real link, so it can be
copied, opened in a new tab and followed by a crawler — clicking one scrolls the page to the
matching heading.

### How it finds the markdown

By walking the screen, in reading order — not by looking for anything in the page's HTML.
That's what makes it work everywhere: on the canvas, in Preview and on the published site.

- **Left empty**, it takes the **first** Markdown element on the screen.
- **Set** to a specific element, it takes that one.
- Set to an element that's **since been deleted**, it falls back to the first one. Deleting
  and re-adding a Markdown element is exactly what re-pasting a document looks like, and a
  published page with an empty aside is the worse outcome.

Put the contents list wherever you like — most often in an aside column beside the document,
or above it on narrow screens. It doesn't have to be near the Markdown element, or after it.

## Heading links

Every `##` and `###` heading gets an anchor id built from its own words:

- lower-cased, with accents folded to plain letters (`Résumé` → `resume`)
- anything that isn't a letter or a digit becomes a hyphen, and runs of hyphens collapse
- leading and trailing hyphens are trimmed

So `## Your Rights & Choices` is `#your-rights-choices`, and `### Section 4.2 — Retention`
is `#section-4-2-retention`.

The rule is deterministic: **the same words always produce the same link**. Re-pasting an
updated document doesn't break links people have already shared or bookmarked, as long as
the heading still says the same thing.

If a document repeats a heading, the second one gets `-2`, the third `-3`, and so on in
document order — and the numbering skips anything already taken, so a document containing
`## Notice` twice *and* `## Notice 2` still ends up with three distinct links.

:::note
Anchors come from the document's own words, so two Markdown elements on one screen with the
same headings will produce the same ids twice. On a page like that, give the second document
distinct headings — or split it onto its own screen, which is usually what it wanted anyway.
:::

## Related

- [Element catalog](element-catalog.md)
- [Text editing](text-editing.md) — for headlines and short copy, where Typography is the
  right element
- [Screens and layouts](../screens-and-layouts/overview.md)
