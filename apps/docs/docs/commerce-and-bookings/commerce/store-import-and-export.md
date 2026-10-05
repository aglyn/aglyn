---
sidebar_position: 4
title: Import and export store data
description: Bring products in from a file or from Shopify, update them by handle or SKU, and export products, orders, discounts, coupons, gift cards and categories with the fields you choose.
---

# Import and export store data

Your store's products, categories, orders, discounts, coupons and gift cards
each have an **Export** button, and the ones a file may change have an
**Import** button. Export lets you pick every field, including computed ones.
Import shows you how each column is read and which record each row matches, and
asks how to handle every conflict before anything is written.

| What | Where | Import | Export |
| --- | --- | --- | --- |
| Products and variants | **Products** page, above the table | Yes | Yes |
| Categories | **Categories & collections** card | Yes | Yes |
| Discounts | **Discounts** card | Yes | Yes |
| Coupons | **Coupons** card | Yes | Yes |
| Orders | **Orders** tab, **Export orders** | No | Yes |
| Gift cards | **Gift cards** card | No | Yes |

You need permission to manage the site's data to import or undo an import.
Exporting needs read access to the site.

## Export

**Export** opens a dialog with every field the records have, grouped and
searchable:

- **Presets** fill the field list. **Re-importable** (the default) puts the
  Aglyn ID and the fields a re-import matches on first, then every field an
  import can write, so the file comes back in and finds its records.
  **Everything** adds computed and system fields. **Minimal** keeps the ID and
  the match fields. You can save your own list as a preset, and your last
  choice is remembered.
- **Records**: everything, or what the list's filters and search find. On the
  Products page and the Orders tab, the filter is the same query the table
  runs, so the file holds every match in the store, not only the page on
  screen. There is no 5,000-order limit.
- **Format**: CSV for a spreadsheet (with an optional byte-order mark for
  Excel), JSON, or NDJSON.

The file is built on the server and checked when it arrives. A download that
stops short is refused rather than saved half-written.

### Products are a row per variant

A product with three variants is three rows. The product's own fields (title,
description, tags and so on) are on its first row, and every row carries the
product's **Handle** and its ID. Images follow the same pattern: the first
image on the first row, the next on the second, and extra rows holding only
the handle and an image when a product has more images than variants.

### The Shopify preset

Products have a **Shopify** preset. It writes Shopify's product CSV:
Shopify's columns, in Shopify's order, under Shopify's column names
(`Handle`, `Title`, `Body (HTML)`, `Option1 Name`, `Variant SKU`,
`Variant Price`, `Image Src` and the rest), so the file can be uploaded to
Shopify as it is. It leaves out **Status**, because **Published** says the
same thing, and **Kind**, which Shopify's `Type` column does not mean.

## Import

**Import** opens an eight-step wizard:

1. **Upload** a CSV, JSON or NDJSON file. The separator, encoding and header
   row are detected, and you can change any of them.
2. **Columns**: each column is matched to a field, with how sure the match is
   and why. A Shopify product export is recognized column for column. Remap
   or ignore any column.
3. **Values**: list values the store does not hold. For a product's
   **Kind**, **Status** or **When sold out**, map each unknown value to one
   the store has, leave it blank, or refuse the rows. For **Categories**, you
   can also add a name as a new category.
4. **Matching**: how many rows find an existing record, how many are new,
   and which are ambiguous.
5. **Conflicts**: what happens on a match (update, skip or make a copy), on
   no match (create or skip), and per field (overwrite, fill only blank
   fields, keep what is there). Rules the store keeps are shown locked with
   the reason.
6. **Review**: a dry run of every row, with a before → after table and every
   class of warning. Each class needs an "I understand" before Import is
   enabled.
7. **Import** writes in chunks. You can pause and resume it.
8. **Results**: a result file of every row, and **Undo** for seven days. A
   record edited since the import is shown to you rather than overwritten.

By default an import **fills blank fields and never overwrites** what a record
already has. To change prices, stock or anything else that is set, choose
**Overwrite** for those fields in the Conflicts step.

### Products

Rows that share a **Handle** are one product: the first row's product fields,
every row's variant, every row's image. A row without a handle is a product of
its own, and its handle is made from its title.

- **Matching** tries the **Handle**, then the **SKU**, then the Aglyn ID. A
  matched product is **updated**. (Before, a file whose handle was taken
  created a second product under a new handle.) A row with only a SKU and,
  say, an **Inventory** column updates that variant's stock.
- **Variants** are matched within the product by SKU, then by their option
  values, then, for a product with one variant, that variant. A row naming a
  variant the product does not have adds it.
- **New products** need a **Title** and a **Price** for each variant. They
  count against your plan's product allowance, and a file with more new
  products than the plan has room for fails the rest in the dry run. A handle
  another product holds, even a deleted one, gets a free one (`mug-2`), and
  the dry run says so.
- **Stock** that a file changes is logged in the stock history as a
  correction.
- **Prices** are in US dollars. A price in another currency is not converted;
  the cell is dropped and the dry run says so.
- **Tags** keep their case. Smart collections match a tag exactly.

What a file does not change:

- **An existing product's handle.** It is the product's address. Change it in
  the product editor.
- **An existing option's name.** Renaming an option moves every variant, and
  the product editor does that. A file can name an option a product does not
  have yet.
- **Stock kept by location.** Change it per location on the products page.
  The dry run says which rows it held back.
- **Products the store would refuse**, such as a compare-at price at or below
  the price, or more than 100 variants. The dry run fails those rows and gives
  the reason.

With Aglyn AI on, the wizard's **After import** step offers **Write
descriptions, search listings and tags with AI as they land**. The copy waits
on the Products page for your review; nothing is saved until you apply it.

### Categories

Matched by slug, then by name. **Parent** names another category by its slug
or name, including one created earlier in the same file. A parent the site
does not have, or a parent that would put a category under itself, fails that
row.

### Discounts and coupons

Discounts match by code, then name. Coupons match by code, which is the
coupon's ID. A **new discount or coupon starts switched off** unless the file
has an **Active** column that says otherwise. How many times one has been
used is exported but never imported.

### Orders and gift cards are exported only

An order is the record of a sale, written by checkout, the register or a paid
draft order. A gift card's balance is money a shopper can spend, so a card is
issued from the **Gift cards** card, with its risk checks and its email. A file
cannot create or change either.

:::caution A gift card's ID is its code
The **Code** in a gift card export spends the card's balance. Keep the file as
safe as the cards themselves.
:::
