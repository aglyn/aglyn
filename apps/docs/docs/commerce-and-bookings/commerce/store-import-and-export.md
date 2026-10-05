---
sidebar_position: 4
title: Import and export store data
description: Bring products in from a file or from Shopify, update them by handle or SKU, move gift cards by issuing each one, and export products, orders, discounts, coupons, gift cards and categories with the fields you choose.
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
| Gift cards | **Gift cards** card | Yes, by issuing each card | Yes |

You need permission to manage the site's data to import or undo an import.
Importing gift cards also needs you to be an owner or admin of the workspace,
or an admin of the site. Exporting needs read access to the site.

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
   the reason. A gift card import adds a **Confirm the cards** step here
   (see [Gift cards](#gift-cards)).
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

### Gift cards {#gift-cards}

Use a gift card import to move cards over from another platform. A file never
writes a balance. Each row **issues a card** the same way **Issue gift card**
does on the **Gift cards** card: the amount is checked, the code is never
overwritten, the card records who issued it, and the site's activity log gets
a line for it.

- **Code**: the code the shopper already holds, so their card keeps working.
  Spaces are removed and letters are upper-cased (`abcd efgh 1234` becomes
  `ABCDEFGH1234`). A code is 8 to 40 letters, digits, hyphens or
  underscores. Leave it blank and a new one is made.
- **Balance**: what the card is issued for, in US dollars. It must be more
  than $0 and no more than $1,000, the most one card can be issued for. A
  row in another currency, from the balance cell or a **Currency** column, is
  refused, not converted.
- **Recipient email** and **Note** are kept on the card, as when you issue one
  by hand.

**A code that another card already holds** is never changed. On the
**Conflicts** step, choose per row (or for every match):

- **Skip this row**: the existing card stays as it is.
- **Create a new record instead**: the card is issued under a new code. Nobody
  holds that code yet, so email it to the recipient or share it yourself.
- **Update the record** is refused for gift cards. The dry run fails the row
  and says why.

**Confirm the cards** comes after Conflicts. It lists every card the import
will issue, with its code, value, recipient and note, and the total they add
up to. Type that total to go on. The server issues nothing unless the total
you typed is exactly the total of the cards it is about to issue. If the cards
change after you type it, the review warns you and no card is issued until
you confirm the new total. The same step asks whether to **email each
recipient their code**. This is off by default, because cards moved from
another platform carry codes your shoppers already have.

The **Review** step shows every card with its code and value, and a warning
that states the total. You must check "I understand" before **Import** is
enabled.

**Undo** voids the cards the import issued. Voiding sets the balance to zero
and keeps the card on record, the same as **Void** on the Gift cards card. A
card that has been used, or that a checkout is paying with right now, is
**never voided**. It is listed as a conflict and keeps its balance, even if
you choose to undo it.

### Orders are exported only

An order is the record of a sale, written by checkout, the register or a paid
draft order. A file cannot create or change one.

:::caution A gift card's ID is its code
The **Code** in a gift card export or import spends the card's balance. Keep
the file as safe as the cards themselves.
:::
