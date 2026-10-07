---
sidebar_position: 4.5
title: Sales channels
description: List your products on Google, YouTube, Facebook, Instagram, TikTok, Pinterest, Snapchat and Microsoft Shopping with a product feed for each.
---

# Sales channels

Sales channels put your catalog in front of shoppers on **Google** (Shopping,
free listings, Search, Images and YouTube), **Meta** (Facebook and Instagram),
**TikTok**, **Pinterest**, **Snapchat** and **Microsoft Shopping** (Bing and
Copilot). Each channel reads its own **product feed** from your store on a
schedule you set on the channel's side, so a price, photo or stock change
reaches it without another upload.

Sales channels come with every plan that sells online. They are set up under
**Products → Settings → Sales channels**, with one card per channel.

## Turn on a channel {#turn-on-a-channel}

1. On the channel's card, switch the feed **On**. The card shows the feed's
   address.
2. Select **Copy address**.
3. Follow the steps on the card: each one opens the channel's own setup and
   says where the address goes. In short:

| Channel | Where the address goes | Format |
| -- | -- | -- |
| Google | Merchant Center → Products → add products from a file → enter a link to your file | XML |
| Meta | Commerce Manager → Catalog → Data sources → data feed → scheduled feed | XML |
| TikTok | Ads Manager → Assets → Catalogs → add products with a data feed → scheduled feed | CSV |
| Pinterest | Ads → Catalogs → create a data source | TSV |
| Snapchat | Ads Manager → Catalogs → add products from a feed URL | CSV |
| Microsoft | Microsoft Advertising → Merchant Center → Catalog → Feeds → scheduled download | Text |

Set the channel to fetch at least daily. Products appear on **YouTube** through
Google: link your YouTube channel to Merchant Center in Merchant Center's
settings.

The address appears once the site has a web address — a subdomain or a custom
domain — and it is always on your store's own domain.

### Keep the address private {#keep-the-address-private}

Each feed's address carries a long random code, different for every channel,
and the feed answers only that address. Anyone holding it can read what your
storefront already shows publicly, nothing more. If an address is shared by
mistake, select **Replace address** (site admins): the old address stops at
once and the card shows the new one to paste into the channel.

Switching a feed **Off** stops it answering; switching it back on keeps the
same address, so the channel picks up where it left off.

## What each product sends {#what-each-product-sends}

Every **active** product is listed; drafts, archived and deleted products
never are. A product with options (sizes, colors) is listed once per variant,
grouped so the channel shows them as one product with choices.

Each listing carries:

- the name (with the variant's choices), description, product page link and
  photos — the variant's own photo first, then up to 10 more (20 for Meta);
- the price in your **store's currency**, and the sale price when a
  compare-at price is set above it;
- availability from your stock: in stock, out of stock, or backorder when
  the product keeps selling after it runs out;
- the brand, barcode (GTIN), part number (MPN), condition and Google product
  category — see below;
- your store's category path, and the variant's color and size;
- the weight and, for Google, the packed size;
- shipping: the cheapest rate to each country your shipping zones name, from
  the same rates checkout charges.

There is no limit on catalog size.

### Brand, barcode and category {#brand-barcode-and-category}

Channels match listings to products they know by their identifiers. In the
product editor, the **Shopping channels** section holds a product's:

- **Brand** — what shoppers know it by.
- **Barcode (GTIN)** — the UPC, EAN, ISBN or JAN on the packaging. A product
  with variants keeps a barcode per variant, in each variant's barcode field.
  A barcode whose last (check) digit does not match is not sent, because
  channels refuse it.
- **Part number (MPN)** — the manufacturer's number, for products with no
  barcode.
- **Condition** — new, refurbished or used.
- **Google product category** — an id such as `2271` or a path such as
  `Apparel & Accessories > Clothing > Dresses`.

A product you make yourself usually has no barcode: leave it blank, and the
feed tells Google and Microsoft the product has no manufacturer identifiers.

**Defaults for every feed**, at the top of the Sales channels card, fill what a
product leaves blank: the brand (blank sends your store's name), the condition
and the Google product category.

### Shipping {#shipping}

Feeds state the cheapest shipping rate to each country your
[shipping zones](./shipping.md) name. A rest-of-world (`*`) zone names no
country, so set shipping for those countries in the channel itself.

Where checkout prices shipping by [carrier rates](./shipping.md), the price
depends on the address, so the feeds send none for those countries. In Google
Merchant Center, set up **carrier-calculated shipping** for them: it prices
each product from the weight and packed size the feed sends, so add both in
the product editor.

## Check your products {#check-your-products}

Select **Check products** on the Sales channels card. Each channel's card then
counts the products it lists, leaves out and lists with suggestions, and
**Show products** names each one with what to fix.

A product is **left out** of a channel's feed when the channel would refuse
it anyway:

- it has no photo or no price;
- it is a service, or sold only as a subscription — shopping channels list
  goods sold at one price;
- the site has no web address yet, or no product page template is chosen in
  the store settings, so the product's link would not open.

A **suggestion** means the product is listed but may show less widely: no
barcode or part number, no description (its name is sent instead), a name
longer than the channel shows, clothing without a Color and a Size option, or
missing shipping.

## How fresh the feed is {#how-fresh-the-feed-is}

A product you edit and save reaches the next fetch at once. Stock that a sale
takes reaches it within 30 minutes. Each card shows when the channel last read
its feed.

## The earlier Google Merchant Center address {#earlier-merchant-center-address}

Stores that set up Merchant Center before sales channels existed used an
address ending in `/api/commerce/feed?hostId=…`. It keeps working, now with
everything above, until you retire it: once Merchant Center reads the Google
card's address, select **Turn off** beside the earlier address on the Google
card. Replacing the Google address turns it off too.

## Turn sales channels off for a site {#turn-off}

Sales channels are on for every site in a workspace. A site admin can switch
them off for one site under **Admin → Plugins → Sales channels**. Every feed of that site, the earlier Google address included, then stops
answering; each feed's address, switch and the defaults are kept for when it
is switched back on.

## Related

- [Catalog](./catalog.md)
- [Shipping](./shipping.md)
