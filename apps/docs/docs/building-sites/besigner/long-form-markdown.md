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

Drop **Markdown** from the **Text** group of the **ELEMENTS** drawer, then write or paste your
document into the **Content** attribute.

**Content** is a visual editor, not a text box. Headings, bold, italic, links, lists, quotes,
images, code blocks and tables all have toolbar buttons, and the shorthands below still work
as you type — start a line with `## ` and it becomes a heading. Pasting from a word processor
or a Google Doc keeps its formatting rather than arriving as one flat paragraph.

The toolbar's **Markdown** switch shows the raw source instead, for when you want to paste a
whole file in one go or check exactly what's stored. Both views edit the same text — the
element stores markdown either way.

**Double-click the element on the canvas** to get the same editor over the document itself,
without going to the attributes panel — the same gesture that edits any other text element
[in place](text-editing.md). What you type is kept as you type it, so **Done**, pressing
`Esc`, and clicking another element all leave the document saved; use undo (`⌘Z`) to take an
edit back.

Text is set for reading rather than for a layout: 17px on a generous line height, in the
theme's primary text colour, with headings that step up in size on wider screens. You don't
need to style anything for it to look right.

The element draws its **Content** attribute and nothing else, so it takes no child elements —
there's no position in a parsed document an element could occupy. Dropping onto it places your
element **next to** the Markdown block rather than inside it, the same way every other
[leaf element](drag-drop-hierarchy.md#leaf-elements-dont--dropping-on-one-makes-a-sibling)
behaves. To put a picture *in* the document, write it as markdown — `![alt](https://…)` — and to
put one beside the document, drop an **Image** as a sibling.

### What the markdown supports

| You write | You get |
| --- | --- |
| `## A heading` | A top-level heading — and an anchor a contents list can link to |
| `### A sub-heading` | A second-level heading, also anchored |
| `**bold**`, `*italic*` | Bold and italic |
| `[text](https://example.com)` | A link. `/pricing` works too, and navigates without a page reload |
| `- item` | A bullet list (`*` works as well) |
| `1. item` | A numbered list (`1)` works as well). Start at any number — `7.` counts from seven |
| `> quoted` | A quote, set off behind a left accent |
| `![alt](https://…)` | An image |
| ` ```lang ` … ` ``` ` | A fenced code block |
| `\| A \| B \|` … | A pipe table, with `:--`/`:-:`/`--:` alignment |

Blank lines separate blocks. `#` and `####` and deeper are still headings — they fold onto
the two levels above rather than being read as ordinary text, so a document that opens with
a single `# Title` renders the way you'd expect.

A list can start directly under the line that introduces it, with no blank line between —
`A notice must include:` followed straight away by `1.`, `2.`, `3.` gives you the sentence
and then the list. The list ends at the first line that isn't an item, and that line starts
a new paragraph. One deliberate exception keeps prose safe: a numbered list can only break
into a paragraph this way when it starts at **1**, so a sentence ending `…the web grew up in`
and continuing `1997. A good year for the web.` stays a sentence. Leave a blank line before
the list if you really do want it to start at another number.

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
