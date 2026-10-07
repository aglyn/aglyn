# @aglyn/plugins-sales-channels

Product feeds of a store's catalog for Google (and YouTube), Meta, TikTok,
Pinterest, Snapchat and Microsoft Shopping, read through core's
`core.product-catalog` contract (AGL-3637).

## How it fits

- **Catalog**: the commerce plugin answers `core.product-catalog`
  (`libs/aglyn/src/lib/plugin-manager/plugin-product-catalog.ts`) with every
  listed offer, one per variant, paged. This plugin never imports commerce.
- **Feeds** (`tenantApi`): `GET /api/sales-channels/feed/{channel}/{token}.{ext}?hostId=`
  on the store's own domain, a machine route locked by a per-channel random
  token (`server/feed-route.ts`), streamed page by page from pages cached under
  the site's data tag (`server/catalog-source.ts`). The site gates a dispatcher
  skips for a machine route are asked by `server/site-gate.ts`.
- **One row per offer per channel**: `model/feed-columns.ts#resolveOffer`
  decides what each channel's file holds and what it leaves out; the writer
  (`model/feed-writer.ts`), the diagnostics (`model/diagnostics.ts`) and the
  API sync all read it.
- **The earlier Google address** `/api/commerce/feed?hostId=` is still
  commerce's route and answers through core's `core.catalog-feed`, which this
  plugin registers from `declarations.server.ts`.
- **Console** (`consoleApi`, `console`): a card per channel in commerce's
  `commerceSettings` zone and the channel fields in its `productEditor` zone.
  State lives in `hosts/{hostId}/salesChannels`, which no client may read or
  write (`cloud/firebase-firestore.rules`).
- **Shipping**: prices come from commerce's own zone table; countries priced by
  live carrier quotes (the shipping plugin, through `core.shipping-rate-quoter`)
  are named on the store and left to each channel's carrier-calculated rates,
  priced from the weight and packed size the feed sends.

## Phase 2 environment

The feeds need no configuration. These variables add the optional **API
connection** on the Google and Meta channel cards, which pushes the products a
feed lists straight to the merchant's own Merchant Center account or Meta
catalog. They are read by the console only (`src/lib/server/connect/config.ts`),
and every operator-facing detail is in
`apps/docs/docs/developers/self-hosting-environment.md#sales-channels`.

| Variable | Gates |
| --- | --- |
| `GOOGLE_MERCHANT_CLIENT_ID` | The Google connection: with the secret and the token key, the Connect button on the Google card and the connect, select, sync and disconnect routes for `google`. |
| `GOOGLE_MERCHANT_CLIENT_SECRET` | The same; the code exchange and every token refresh. |
| `META_CATALOG_APP_ID` | The Meta connection: with the secret and the token key, the Connect button on the Meta card and the routes for `meta`. |
| `META_CATALOG_APP_SECRET` | The same; the token exchanges and the `appsecret_proof` on every Graph call. |
| `META_GRAPH_API_VERSION` | Optional. The Graph API version, `v26.0` when unset. |
| `SALES_CHANNELS_TOKEN_KEY` | Both connections. 32 random bytes, base64, sealing every stored token with `secret-box`; a comma-separated list rotates. Unset, neither provider is offered. |

A provider whose variables are not all set does not exist on the deployment:
the state route lists no `connect` entry for it, the card draws nothing, and its
routes answer 404. The OAuth `state` is signed with the shared
`TOKEN_SIGNING_SECRET`.

Register `{console origin}/api/sales-channels/connect/callback` as the redirect
address on both the Google OAuth client and the Meta app.

What a connection does:

- **Google** — Merchant API v1 (the Content API was retired 2026-08-18): the
  grant's Merchant Center accounts are listed, one API data source is created in
  the chosen account, and each offer the Google feed includes is inserted as a
  product input; one sent before that the feed no longer includes is deleted.
- **Meta** — the long-lived user token's businesses and owned catalogs are
  listed, and each offer the Meta feed includes is upserted through the
  catalog's `items_batch` edge in chunks of 3,000; deletes likewise. A token
  within seven days of expiry asks for a reconnect on the card.

Both build every value from the same `resolveOffer` row the feed writes, so a
pushed product matches the feed exactly. A sync holds a ten-minute lease per
site and provider, so two clicks never run twice; the last result (sent,
removed, refused, the first ten errors) is kept on the connection. There is no
scheduled sync: a member runs it from the card.
