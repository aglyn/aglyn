---
sidebar_position: 8
title: Product copy and catalogs with AI
description: An AI product description generator for your catalog: have Aglyn AI write copy for one product or a whole import, propose a first catalog, and propose categories and discounts — as proposals you review before anything changes.
---

# Product copy and catalogs with AI

Aglyn AI can write the copy for your products and help you set up a store. Everything it
does is a **proposal**: you review it, and nothing is saved to your catalog until you
apply it. It never sets a price, and it never publishes a product.

:::caution Rolling out
Aglyn AI is a **release-flagged feature, currently being rolled out** — it is not
available in every workspace yet. This page says what it does for a catalog, and grows
with the feature.
:::

## Write a product's copy

In the product editor, under the description, tags and categories, **Write with AI**
writes a proposal from what the product already says and shows:

1. Give the product a name. Its current text, tags, options and first photo help, but
   none of them is required.
2. Press **Write copy**.
3. Review the proposal: a **description**, a **search title** and **search description**
   with their lengths, **tags**, the **categories** it fits from the ones your store has,
   and clearer **option names** where yours are unclear.
4. Press **Put in the fields**, check the fields, and press **Save product**.

Renaming an option this way keeps every variant with its price, SKU and stock.

The copy is written only from your product. Where a shopper would need a fact the
product does not give, such as a material or a size, the description marks it in square
brackets, like **[material]**, and the proposal lists what to fill in before you save.

## Write copy for many products

On the products page, **Build your catalog with AI** has **Write copy for products**.
Pick up to 50 products and press **Write copy**. The copy is written one product at a
time, and each row appears in the review table as it is ready.

- **Apply** saves one product's copy. **Apply to all** saves every row still waiting.
- Applying changes only the description, search listing, tags, categories and option
  names. A price, stock count or anything else changed since the table loaded is kept.
- A product that was deleted, or whose copy could not be held to the rules below, is
  marked **Skipped** and the rest carry on.
- If your AI credits run out partway, the job waits and carries on from the product where
  it stopped once credits are available.

### When you import products

In the **Import products (CSV)** dialog, tick **Write descriptions, search listings and
tags with AI as they land**. Once the import has created your products, their copy is
written as above and waits in the review table on the products page. Copy is written for
the first 50 products of a larger import.

## Propose a first catalog

**Propose products** takes a brief, such as *"a candle studio: hand-poured soy candles in
8 oz and 16 oz jars, and wax melts"*, and proposes up to twelve products, usually six or
more unless your brief says how many: each with a name, type, description, tags, options,
a search listing and a sentence saying what its photo should show.

Review the table, untick any you do not want, and press **Create drafts**. Each product
is created as a **draft**:

- **Its price is left empty**, and the table marks it **Set a price**. The product editor
  will not save the product until every variant has a price, and a product with an empty
  price is never sold.
- **It has no photo**, and the table marks it **Needs a photo** with the suggested shot.
  Nothing is uploaded or linked for you.
- **Nothing is on your storefront** until you price it and set it to **Active**.

A proposed product with the same name as one already in your catalog is left out.

## Propose categories and discounts

**Propose categories and discounts** takes a brief and proposes store categories and up
to five discounts, each with a sentence saying why it suits your store. A discount is a
percentage off, an amount off or free shipping, with an optional minimum order and a code
or no code.

Untick what you do not want and press **Create selected**. Categories appear in your
catalog straight away. **Discounts are created switched off**: a shopper sees none until
you switch it on under **Promotions**. A category or discount your store already has is
left as it is.

## What the copy never says

Every proposal is checked before you see it, and a proposal that breaks a rule is written
again or not shown:

- **No health claims**, such as a product that cures, treats or prevents a condition, or
  is clinically proven or doctor recommended.
- **No financial or legal promises**, such as guaranteed returns, income, or legal
  compliance.
- **No certification, award or endorsement** your own product text does not state. If
  your text says *certified organic*, the copy may say so too.
- **No prices** you did not give, and no links, emoji or formatting marks.

The rules help, but you are still the publisher: read the copy before you apply it.

## What is sent to the AI provider

To write a product's copy, the product's name, type, current text, tags, options and
current search listing are sent, with your store's name and the names of your store's
categories. For a proposal from a brief, your brief and your store's name are sent, and
for categories, the names of the categories you already have.

A product's **first photo** is sent only when it is in your site's or organization's
media library, and only as a smaller copy: at most 768 pixels on its longer side, saved
fresh as a JPEG, without the original file's details such as the camera or the location
it was taken. **Nothing else from your media library is sent**: no other photo, file
name, folder or description. A photo that is a link to another website is not sent at
all. No price, stock count, order or customer is ever sent.

## Who can use it

Products with AI needs the **Generate with AI** permission, a plan that includes commerce,
and Commerce switched on for the site. Each request uses AI credits. See
[who can use AI assist](overview.md#who-can-use-it).

## Related

- [Product catalog](../commerce-and-bookings/commerce/catalog.md)
- [SEO by AI](../building-sites/seo/seo-by-ai.md)
- [How Aglyn AI builds](./how-aglyn-ai-builds.md)
