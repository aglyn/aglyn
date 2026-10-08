---
sidebar_position: 4.7
title: Marketplaces (Amazon, eBay, Etsy, TikTok Shop, Walmart, Faire)
description: Keep your Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire listings in step with your store's stock, bring their orders in as your orders, and send tracking back. Rolling out.
unlisted: true
---

# Marketplaces: Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire

:::caution Rolling out
Marketplaces are **not yet available** on aglyn.com-hosted workspaces. Until
they are, no **Marketplaces** card appears in your store's settings.
:::

If you also sell on a marketplace, connect your seller account there to your
store and sell everywhere from **one stock count**:

- **Listings follow your stock.** Each listing whose seller SKU matches one of
  your products shows the units you have, less any you keep back. You can send
  your prices too. On Amazon and eBay, products with no listing yet can be
  published there.
- **Marketplace orders become your orders.** Each paid order the marketplace
  takes comes into your store with its own order number. Its units come off
  the same shelf your website and register sell from, at the same moment, so
  the last unit cannot be sold twice.
- **Tracking goes back.** When you ship a marketplace order from Aglyn, the
  carrier and tracking number are sent to the marketplace, which tells the
  buyer.

## Connect a marketplace {#connect-a-marketplace}

1. Open your store's **Settings** and find the **Marketplaces** card.
2. Next to the marketplace, select **Connect**.
3. Sign in to your own seller account there and allow Aglyn access. You come
   back to the store settings with the marketplace connected.

You need to be an admin of the site to connect, change or disconnect a
marketplace. Aglyn never sees your marketplace password; it keeps only the
access the marketplace grants, encrypted. Disconnecting deletes that access.
Orders already imported stay in your store, and your listings stay on the
marketplace with the stock they last showed.

## Listings {#listings}

Listings are matched by **seller SKU**: give each product (or each variant)
the same SKU it has on the marketplace. Under **Listings**, choose:

- **Keep matching listings in step** (the default): every matched listing
  shows your stock. Products with no matching listing are shown under
  **Listings to look at**.
- **Keep in step and publish the rest** (Amazon and eBay): a product with no
  listing there is published. Amazon publishes an offer on an existing catalog
  page, so the product needs a barcode (GTIN). eBay needs a photo, your eBay
  business policies and an inventory location.
- **Leave listings alone**: orders still come in, and listing stock is yours
  to keep up on the marketplace.

Other settings:

- **Units kept back** holds that many units of every product back from the
  marketplace, so a sale elsewhere just before a sync cannot oversell it.
- **Untracked products show** is the quantity offered for a product that does
  not count stock.
- **Send prices too** sends your selling price, adjusted by the **Price
  adjustment** percent, for example `15` to cover the marketplace's fees.
  Faire's prices are wholesale and stay as you set them on Faire.

Listings sync every 30 minutes, and at once after any sale, cancellation,
refund or returned item on any channel.

## Orders {#orders}

Paid orders that you ship yourself come into your store within about ten
minutes, marked **Marketplace** with the marketplace's own order number on
them. Orders the marketplace ships from its own warehouse (Fulfilled by Amazon,
Walmart Fulfillment Services, Fulfilled by TikTok) are not imported.

- **Stock.** Each item is matched by SKU and its units come off your shelf. If
  the marketplace sold more than you had, the order still comes in and you are
  told what is short. An item that matches no product comes in by name.
- **Money.** The buyer paid the marketplace, which pays you out. Aglyn charges
  nothing on these orders. The marketplace's fees are recorded on the order
  for your books when the marketplace states them. Refunds happen on the
  marketplace.
- **Tax.** The marketplace collects and remits the tax on its orders.
- **Canceled on the marketplace.** An order canceled there before you ship it
  is canceled in your store and its units go back on the shelf.
- **Shipping.** Ship the order from the order dialog as usual, with a carrier
  and tracking number. The tracking is sent to the marketplace, and the order
  dialog's **Marketplace** section shows whether it arrived. A shipment with
  no tracking number is not sent; confirm it on the marketplace yourself. If
  the marketplace refuses one, the section says why: put right what it names
  and select **Send tracking again**.
- **Currency.** An order in a currency your store does not sell in is not
  imported; ship it from the marketplace.

No email is sent from your store to a marketplace's buyers: the marketplace
sends its own.

## Activity {#activity}

Under each connected marketplace, **Activity** lists orders imported, tracking
sent, listing syncs and errors, newest first. **Sync now** reads orders and
brings listings in line immediately, and **Pause** stops both until you resume.
If a marketplace stops accepting the connection, the card says **Connect
again**.
