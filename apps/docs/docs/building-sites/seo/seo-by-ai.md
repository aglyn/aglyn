---
sidebar_position: 2
title: AI SEO for your website
description: AI SEO for websites, on the pages you already have: have AI write a page or product's search listing, audit every published page with a proposed fix for each finding, and draft your structured data and /llms.txt.
---

# AI SEO for your website

AI can write the search listing for a page or a product, audit your whole site, and
draft the structured data and agent guidance your site publishes. Everything it does is
a **proposal**: it lands in the editor or the form as unsaved changes, or in a new draft
version, and your live site changes only when you save or publish.

SEO by AI is part of AI generation. Each proposal uses AI credits, and every card shows
how many a request used.

## Write a page's listing

On a screen's detail page, the **SEO** card has a **Write with AI** section:

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

## Audit the whole site

**Setup → SEO** has an **SEO audit** card. Press **Run audit**; it runs in the
background, and you can leave the page while it works.

The audit covers the pages your [sitemap](./overview.md#sitemap--robots) lists: every
published page whose visibility is **Public**, without template screens or error pages.
A very large site is audited on its first 150 pages, and the card says how many it left
out. For each page it checks:

| Check | What counts as a finding |
| --- | --- |
| **Search title** | Missing, over 60 characters, or the same as another page's. |
| **Search description** | Missing, over 155 characters, or the same as another page's. |
| **Main heading** | No `h1`, more than one, or one that says little (`Home`, `Welcome`, a single short word). |
| **Images** | An image with no description. |
| **Links** | No other page or shared layout links to the page. The home page never counts. |
| **Target keywords** | A keyword you named that the page never says. |

It also checks the site as a whole: whether search engines are asked to stay away,
whether your structured data names and describes who publishes the site, and whether
your `/llms.txt` carries guidance of your own.

Each page gets a score, and each finding gets a proposed fix. A page nothing links to
gets advice instead of a fix, because only you can choose where the link belongs.

### Target keywords

The optional **Target keywords by page** box takes one line per page:

```text
/pricing: pricing, plans
/lamps: brass desk lamps, dimmable
```

The audit reports where each page already says its keywords. A proposed title or
description uses a keyword only where the page is about it — at most once in a title and
once in a description — and never lists keywords or repeats a word to rank.

## Apply all as drafts

When the audit finishes, **Apply all as drafts** does three things, and none of them
changes your live site:

- **Content fixes open a new draft version** of each page that has one: a description
  for each undescribed image, and one clear main heading. Your published version is not
  touched. Open the draft from the card, review it, and publish it when you are ready.
- **Titles and descriptions wait in each page's SEO card.** Open the page from the card,
  press **Put in the fields** under **Proposed by the site audit**, and save.
- **Structured data and agent guidance go into the SEO form** below the card as unsaved
  changes. Review them and press **Update**.

Applying the same audit again opens no second draft of a page.

## Structured data and /llms.txt

The audit proposes the parts of **Setup → SEO → Entity** and **AI agents** that are
still empty: whether an organization or a person publishes the site, a one-sentence
description of the publisher, and guidance on when an AI agent should use your site. A
contact email or phone number is proposed only when one of your pages shows it.

**Preview /llms.txt** shows the file as it will read once you save the guidance. The file
your site serves changes only after you press **Update** in the form.

## Related

- [SEO Toolkit](./overview.md)
- [AI assist](../../ai/overview.md)
