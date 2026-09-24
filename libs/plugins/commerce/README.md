# @aglyn/plugins-commerce

The Commerce plugin for Aglyn: products, carts, checkout, orders and point of sale, plus the visitor accounts and member blocks that ship in the same bundle. Install it if you are running or building on the Aglyn platform and want a storefront.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-commerce@beta

Peer dependencies:

- `@mui/material`
- `firebase`
- `next`
- `react`

None is optional. The server half additionally relies on `firebase-admin` through `@aglyn/tenant-data-admin`.

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

### On a published site

`registerCommercePlugin()` registers these canvas components, placed in Besigner like any other element:

- Storefront: `product-grid`, `product-detail`, `related-products`, `product-reviews`, `cart`, `wishlist`, `reservation-widget`, `newsletter-signup`
- Accounts and members: `customer-account`, `member-signin`, `member-signup`, `member-recovery`, `member-feed`, `gate`, `gated-video`

Component ids are persisted in screen documents and are never renamed.

The entry in `plugins.config.json` also declares an `accounts` capability ("User Accounts"): visitor accounts on the site, with the sign-in, sign-up and recovery pages and the member blocks. It requires commerce, is off for a site until turned on, and has no separate package; this bundle registers its blocks and its `membership/*` handlers.

### In the console

`registerCommerceConsole()` registers:

- A **Products** nav item and page at `/products`, with the sections Catalog, Orders, Promotions, Reservations, Settings and Analytics as routes.
- A **POS** nav item and page at `/pos`, which requires the plugin's own `managePos` permission.
- A "Commerce" widget in the `commerceGlance` slot, and a "Newest site users" widget in the `hostDashboard` slot under the accounts capability.
- The plugin's permissions (`COMMERCE_PERMISSIONS`) and its config schema (`COMMERCE_CONFIG_SCHEMA`, which holds the POS discount ceiling).

All console pages and cards are code-split.

### On the server

`@aglyn/plugins-commerce/server` pulls in `firebase-admin` and Stripe and is kept out of the client entry point.

- `registerCommerceApi()` (the `tenantApi` surface) registers the storefront routes under `commerce/` (catalog, product, related, reviews, cart, cart checkout, checkout, download, feed, newsletter, restock notifications, order analytics, reservations, gate, member feed, stream, subscription portal) and the account routes under `membership/` (register, login, logout, recover, reset, account, content, wishlist). It also registers a site page resolver and enricher, the commerce tax profile and a product card reader on core seams.
- `registerCommerceConsoleApi()` (the `consoleApi` surface) registers the merchant routes: cancel, fulfill and refund an order, draft orders, POS orders, gift cards, member posts, a site member's password help and removal (`membership/admin-password`, `membership/admin-remove`), Stripe Connect, supplier updates, and the abandoned-checkout and restock processors. It also adds a handler on the platform billing webhook and order figure readers.
- Loading the module registers scheduled plugin jobs: `abandoned-checkout-recovery`, `back-in-stock-alerts`, `stock-decrement-reconciliation` and `supplier-webhook-delivery`. This is why `package.json` lists `./src/lib/server.*` under `sideEffects`.

Routes are served by the host app's API dispatcher under `/api/`, for example `/api/commerce/catalog`.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-commerce` | `BUNDLE_ID`, `registerCommerceConsole`, the site half, and the pure model: carts (`upsertCartLine`, `removeCartLine`, `cartCount`, `mergeCarts`), product CSV (`productsToCsv`, `parseProductsCsv`), and the order, discount, promotion, gift card, reservation, shipping, stock hold and tax modules |
| `@aglyn/plugins-commerce/site` | `registerCommercePlugin` and `COMMERCE_BUNDLE` only. This is what a published page loads, so it carries no console code |
| `@aglyn/plugins-commerce/server` | `registerCommerceApi`, `registerCommerceConsoleApi` |
| `@aglyn/plugins-commerce/*` | any module under `src/lib/`. Console components are deep-imported from `@aglyn/plugins-commerce/components/console/...` and are deliberately not re-exported from the root |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders. Called directly:

```ts
// Published site (canvas half only)
import { registerCommercePlugin } from '@aglyn/plugins-commerce/site'
registerCommercePlugin()

// Console app
import { registerCommerceConsole } from '@aglyn/plugins-commerce'
registerCommerceConsole()

// Server-only API dispatcher
import {
  registerCommerceApi,
  registerCommerceConsoleApi,
} from '@aglyn/plugins-commerce/server'
registerCommerceApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Commerce depends on `@aglyn/aglyn`, `@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`, several `@aglyn/shared-*` packages, and the Stripe client libraries. What other plugins need from it goes through core seams: it registers the plugin tax profile that a paid booking is priced with, and the product card and order figure readers other plugins read by contract.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/commerce
