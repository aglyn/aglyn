---
sidebar_position: 2
title: Product catalog
description: Products with options and variants, categories, tags, and manual or smart collections.
---

# Product catalog

The catalog (AGL-276) is the foundation of Aglyn commerce: every storefront
block, checkout, and order line points back at these documents.

![The product catalog](/img/commerce/products-page.png)

## Products, options, and variants

A **product** is what you manage; a **variant** is what a customer actually
buys. Products define up to **3 options** (like Size or Color, each with up
to 25 values), and the products hub expands them into a variants matrix — up
to **100 variants** per product, each with its own SKU, barcode, price,
compare-at price, weight, image, and inventory count.

- **Types**: `physical` (shippable), `digital` (delivered as downloads), or
  `service`.
- **Status**: `draft` (invisible to visitors), `active`, or `archived`. Draft
  and archived products can't be bought online, from the cart or with Buy now.
  A product created for you rather than added in the editor — a proposed
  product, for one — starts as a draft with no photo, at the price it was given
  (an AI proposal's suggested price) or else a default price, for you to change. It counts toward your plan's product
  allowance like any other product.
- **Pricing**: a variant with a **compare-at price** above its price shows a
  sale badge on storefront blocks.
- **Inventory**: leave blank for untracked, `0` means sold out — the same
  semantics the original product block used. Stock is **not** tracked on a
  **digital or service** subscription-only product: nothing decrements it,
  on the first charge or on any renewal, so the field is disabled there. A
  **physical** subscription tracks normally — every paid cycle decrements
  one unit per box shipped — and *Both — buyer chooses* keeps tracking on
  the one-time sales.

Products created with the earlier single-price product block are lifted
into this model automatically as a single default variant — nothing breaks
and no migration step is needed.

## Sell in person only {#sell-in-person-only}

Every product sells online and in person unless you say otherwise. To sell a
product **only in person**, open it in the product editor and, under **At the
register** beside **Quick key at the register**, turn off **Sell online**. The
products list marks it **In person only**.

A product that is in person only:

- **still sells in person**: at the register, at the self-service kiosk, in
  the Aglyn POS apps, and on draft orders;
- **has no page on your site**: its `/products/{slug}` address answers "page
  not found", and it is left out of product grids, collections, search, related
  products, wishlists and the sitemap;
- **cannot be bought online**: it can't be added to a cart, a cart that
  already holds it can't check out until the line is removed, and **Buy now**
  refuses it;
- **is in no channel**: it is left out of every [sales channel](./sales-channels.md)
  feed (Google, Meta, TikTok, Pinterest, Snapchat and Microsoft),
  [marketplace](./marketplaces.md) and [delivery app](./delivery-apps.md)
  menu. An [inventory sync](./inventory-and-erp-sync.md) still counts its stock.

Its reviews still show on your site by default. With **Sell online** off, the
editor offers **Reviews on your site**:

- **Show, marked Sold in store** (the default): its reviews appear in your
  store's [reviews across every product](#show-reviews) and count toward the
  average, with the product's name, a **Sold in store** label, and no link,
  since it has no page.
- **Hide**: its reviews appear nowhere on your site, neither in the list nor
  in the average. You still see and moderate them under
  [Review moderation](#review-moderation).

Back-in-stock emails for it wait until it sells online again. Turn **Sell
online** back on and everything above returns, its reviews included. The switch comes with the point
of sale; on a plan without it, a product already set to in person only still
shows the switch so you can put it back online.

## Offer on the kiosk {#offer-on-the-kiosk}

The [self-service kiosk](pos-and-reservations.md#self-service-kiosk) offers
every product it can sell unless you say otherwise. To keep a product off the
kiosk, open it in the product editor and, under **At the register**, turn off
**Offer on the kiosk**. The kiosk leaves it out of its product grid, and a kiosk
cart that still holds it is refused at checkout. The register, the Aglyn POS
apps and your site sell it as before.

For a product with options, **Variants the kiosk offers** lists each variant.
Clear one to keep only that variant off the kiosk, such as a size you serve
only at the counter. Turn **Offer on the kiosk** back on and the product
returns to the kiosk with the variants you left checked.

The choice comes with the point of sale, like the rest of **At the register**.

## Billing modes and subscriptions

Each product's **Billing** setting picks how buyers pay:

- **One-time purchase** (default) — a normal order.
- **Monthly / Yearly subscription** — buyers subscribe instead of buying
  once; the product page prices as `$X/mo` or `$X/yr`, the buy button reads
  **Subscribe**, and an optional **free trial** (in days) can precede the
  first charge. An active subscription is what members-only content checks.
- **Both — buyer chooses** — the product page shows a one-time /
  subscribe toggle (same price either way, at the interval you pick) and
  defaults to one-time. The choice is validated server-side against the
  product: a one-time sale here is a plain order, while the subscribe
  choice creates a recurring subscription exactly like a
  subscription-only product.

Selling subscriptions (including the subscribe side of *Both*) requires a
plan with storefront subscriptions (Business and above). Subscription
billing applies to the product page's direct checkout — cart checkouts
always charge one-time.

Whether a subscription moves stock follows the product's **Type**. A
**physical** subscription decrements one unit per paid cycle — the first
charge and every renewal each create an order on the **Subscription**
channel and take the box off the shelf, so the stock field stays live and
low-stock alerts apply. A **digital or service** subscription never moves
stock, and the stock field is disabled there; any number already saved is
kept and shown, but it does not cap subscribers and will not change on its
own. A saved `0` still stops new subscribers, so clear it (**Clear stock**
on the notice in the editor) if that is not what you want. On a **Both**
product the stock field stays live, because the one-time sales do
decrement it.

## Write and propose with AI {#ai}

Aglyn AI can write a product's description, search listing and tags from what it says
and shows, write copy for many products or an import at once, propose a first catalog
from a brief, and propose categories and discounts. Every proposal is reviewed before it
is saved. Proposed products are created as drafts at their suggested prices, and
proposed discounts are created switched off. See [Products with AI](../../ai/products-with-ai.md).

## Categories and tags

The **Categories & collections** card, in the products hub's catalog, organizes
your products into categories and collections that storefront pages and filters
use.

**Categories** are hierarchical (each may have a parent) and slugged for
URLs. **Tags** are free-form labels. Both drive storefront filtering and
smart collections.

## Collections

Collections group products for landing pages and storefront blocks:

- **Manual** collections are an ordered, hand-picked list.
- **Smart** collections define rules — match by tag, category, price, name,
  or product type, with *all* or *any* semantics — and membership updates
  automatically as products change. Draft and archived products never
  appear. A smart collection lists every product that matches, however large
  the catalog. Saving or deleting one updates which products it holds right
  away. On a big catalog that can take a few seconds after **Collection
  saved** appears.

On a Product grid scoped to a smart collection, the grid's search box and its
category and tag chips can't be combined with the collection when a rule says a
product's tag or category *is* something, or when the rules are ones a single
query cannot ask: *any* across two or more rules, a tag or category that *is not*, a name, a price
*above* or *is*, or more than one tag or category. Using one of those controls
shows a notice above the grid instead of narrowing it. The type, **In stock**
and price controls still work, and a collection built only from type *is* or *is not*
rules and a price *below* keeps every control. A price *below* rule is a price range, so
that collection's grid is in price order — high to low if that is the sort chosen, low to
high otherwise.

## Product reviews {#product-reviews}

Shoppers rate a product from 1 to 5 and write a review in the **Product
reviews** block on your product page template. Pro plan and above.

### Show reviews on your site {#show-reviews}

The **Product reviews** element, in Besigner's **Commerce** elements, shows
published reviews with the average rating, and the form customers write theirs
in.

1. Open your product page template in Besigner and add **Product reviews**
   below the product details.
2. Leave **Product id** blank, so the block shows whichever product the page
   is showing. Pick a product only to pin the block to that one product.
3. Optionally change its **Heading**, which reads **Reviews** when blank.
4. Publish the site.

To show your store's latest published reviews across every product, on a home
page for example, set **Show** to **Whole store** and choose **Max reviews**
(6 by default, 12 at most). It shows nothing until a review is published. A
review of a product you [sell in person only](#sell-in-person-only) is marked
**Sold in store** and doesn't link anywhere, unless you chose to hide that
product's reviews from your site.

### Review settings {#review-settings}

The **Reviews** card on **Products → Promotions** decides who can review your products
and when customers are asked for a review.

**Who can review.** By default only customers who bought the product can
review it, and their reviews show a **Verified buyer** badge. A customer is
verified when they are signed in to their account on your store with the
email their order went to, or when they open the link in their
review-request email. Typing an email address into the form never verifies
anyone. Everyone else sees "Only customers who bought this can review" and a
**Sign in** link. To accept reviews from anyone, set **Who can review** to
**Anyone** on the **Reviews** card in **Promotions**: verified buyers still
publish right away, and everyone else gives a name and an email (never shown)
and waits for your approval.

**The review-request email.** A set number of days after an order is
fulfilled (7 by default, anywhere from 3 to 30), the buyer gets one email
asking for a review, with a link for each product on the order. Each link
works once, for 60 days, and only for that order, product and buyer. Items
that were refunded are left out, and register sales are never asked. The
email respects unsubscribes and your suppression list. Turn it off or change
the delay on the **Reviews** card, and change its wording under **Emails →
Review request**.

### Review moderation {#review-moderation}

The **Review moderation** card, in the products hub's **Promotions**
section, lists your reviews so you can publish, hide and reply to them:

1. Verified reviews publish as soon as they are written, good or bad.
   You can **Hide** one only for a content reason: spam or advertising,
   abusive or hateful language, not being about the product, or sharing
   private information. The reason is recorded with the review.
2. Reviews from shoppers who are not verified (only when **Who can review**
   is **Anyone**) wait under **Show: Pending**. Select **Approve** to publish
   one, or **Reject** with a reason to keep it off your site.
3. **Reply** adds your answer under a review.

Only published reviews show on your site, with the product's average rating.
Switch **Show** to **Published**, **Hidden**, **Rejected** or **All** to look
back.

## Slugs

Products, categories, and collections each have a host-unique slug used in
storefront URLs (`/products/{slug}`, `/collections/{slug}`). Slugs are
lowercase letters, numbers, and dashes.

## Google Merchant Center feed {#merchant-center-feed}

Your catalog is published as a product feed for Google Merchant Center, and
for Meta, TikTok, Pinterest, Snapchat and Microsoft Shopping too. Each
channel has its own feed address and setup steps on the
**Products → Sales channels** page; see [Sales channels](./sales-channels.md).

## Related

- [Sales channels](./sales-channels.md)
- [Commerce overview](overview.md)
- [SEO](../../building-sites/seo/overview.md) — products emit structured data and join the
  sitemap automatically.
