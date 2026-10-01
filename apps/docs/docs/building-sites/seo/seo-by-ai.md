---
sidebar_position: 2
title: AI SEO for your website
description: "AI SEO for websites, on the pages you already have: have AI write a page or product's search listing, propose a fix for each finding of the SEO check, and draft your structured data and /llms.txt."
---

# AI SEO for your website

AI can write the search listing for a page or a product, propose a fix for everything
the [SEO check](./overview.md#seo-check) finds on your site, and draft the structured data
and agent guidance your site publishes. Everything it does is
a **proposal**: it lands in the editor or the form as unsaved changes, or in a new draft
version, and your live site changes only when you save or publish.

SEO by AI is part of AI generation. Each proposal uses AI credits, and every card shows
how many a request used.

## Write a page's listing

On a page's detail view, the **SEO** card has a **Write with AI** section:

1. Optionally add **target keywords**, separated by commas.
2. Press **Write SEO**.
3. Review the proposal. Each value shows its length against the field's limit.
4. Press **Put in the fields**, check the fields, and press **Save SEO**.

The proposal covers every field of the card:

| Field | Limit | Written from |
| --- | --- | --- |
| **Title** | 60 characters | What the page is about, specifically. Published exactly as written. |
| **Description** | 155 characters | A one- or two-sentence summary of the page. |
| **Breadcrumb label** | 40 characters | The page's short name in a breadcrumb trail. |
| **Image description** | 300 characters | Only when the page has a social image, and only from what the page says about the picture. |

The listing is written from the version you are looking at, in the language of its
text. It never invents a fact, a price or a claim the page does not make, and it does
not reuse a title another page of your site already uses.

## Write a product's listing

In the product editor, the **Search engine listing** section has the same **Write with
AI** control. It proposes an **SEO title** and an **SEO description** from the
product's name and description. Put them in the fields, then press **Save product**.
Give the product a name first.

## Fix what the SEO check finds

The [SEO check](./overview.md#seo-check) on **Setup → SEO** lists what is wrong with each
page; it is free and needs no AI. With AI, the **SEO fixes** card under it proposes a
fix for each finding. Press **Propose fixes**; it runs in the background, and you can
leave the page while it works.

The fixes answer the same findings the check lists, on the same pages. They use the
**Target keywords by page** you typed in the check: a proposed title or description uses a
keyword only where the page is about it — at most once in a title and once in a
description — and never lists keywords or repeats a word to rank.

| Finding | Proposed fix |
| --- | --- |
| **Search title** or **description** missing, too long, or shared | A new title or description, written from the page. |
| **Main heading** missing or saying little | One clear main heading. |
| **More than one main heading** | The extra headings become subheadings. |
| **Images** without a description | A description for up to three images a page, from the text around each; the rest on the next run. |
| **Target keyword** not covered | A title or description that uses it, where the page is about it. |
| **No page links here** | Advice instead of a fix, because only you can choose where the link belongs. |

## Apply all as drafts

When the fixes are ready, **Apply all as drafts** does three things, and none of them
changes your live site:

- **Content fixes open a new draft version** of each page that has one: a description
  for each undescribed image, and one clear main heading. Your published version is not
  touched. Open the draft from the card, review it, and publish it when you are ready.
- **Titles and descriptions wait in each page's SEO card.** Open the page from the card,
  press **Put in the fields** under **Proposed by the site audit**, and save.
- **Structured data and agent guidance go into the SEO form** below the card as unsaved
  changes. Review them and press **Update**.

Applying the same fixes again opens no second draft of a page.

## Structured data and /llms.txt

The fixes propose the parts of **Setup → SEO → Entity** and **AI agents** that are
still empty: whether an organization or a person publishes the site, a one-sentence
description of the publisher, and guidance on when an AI agent should use your site. A
contact email or phone number is proposed only when one of your pages shows it.

**Preview /llms.txt** shows the file as it will read once you save the guidance. The file
your site serves changes only after you press **Update** in the form.

## Related

- [SEO Toolkit](./overview.md)
- [AI assist](../../ai/overview.md)
