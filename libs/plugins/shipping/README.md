# @aglyn/plugins-shipping

Carrier rates at checkout, shipping labels, address validation and parcel
tracking for the orders the commerce plugin sells (AGL-3612). Shippo
(Platform Accounts) is the primary provider and EasyPost (Child Users) the
secondary; each is reached with `fetch` alone.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-shipping@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console and the tenant runtime; it is not a standalone library.

## How it meets commerce

It never imports the commerce plugin, and commerce never imports it. Two
core seams carry everything between them:

- `@aglyn/aglyn/plugin-manager/plugin-shipping-rates` — this plugin
  registers the carrier-rate quoter; a seller asks it at checkout and falls
  back to its own rates when it is absent, unavailable or slow.
- `@aglyn/aglyn/plugin-manager/plugin-shipment-records` — the seller
  registers how to read a record that ships, write a shipment onto it and
  record what the carrier says; this plugin calls it when a label is bought
  and when a tracking webhook arrives.

## Configuration

Nothing shows until the deployment names a provider:

| Variable | What it is |
| -- | -- |
| `SHIPPO_API_TOKEN` | The platform's Shippo token (managed accounts per workspace) |
| `EASYPOST_API_KEY` | The platform's EasyPost key (child users per workspace), used when Shippo's token is unset or `SHIPPING_PROVIDER=easypost` |
| `SHIPPING_TOKEN_KEY` | 32 random bytes, base64: seals every stored account id and key |
| `SHIPPO_WEBHOOK_TOKEN` | The `?token=` Shippo's tracking webhook URL carries |
| `SHIPPO_WEBHOOK_HMAC_SECRET` | Optional: Shippo's HMAC secret, verified when set |
| `EASYPOST_WEBHOOK_SECRET` | The secret EasyPost signs each event with |

Webhooks: `POST /api/shipping/webhooks/shippo?token=…` and
`POST /api/shipping/webhooks/easypost` on the console's host.

## The merchant's own accounts (AGL-3632)

A workspace can ship through an account of its OWN instead of the
platform's: Easyship or Sendcloud for rates, labels and tracking (billed to
the merchant by that service; nothing is recovered here), and ShipperHQ to
price checkout with the merchant's rules. The merchant types their API
credentials into the console once; they are checked with the service,
sealed under `SHIPPING_TOKEN_KEY` and never returned. One label platform at
a time; ShipperHQ sits beside either. Aglyn holds no account with any of
them.

| Variable | What it is |
| -- | -- |
| `SHIPPING_OWN_ACCOUNT_PROVIDERS` | Which services are offered: any of `easyship,sendcloud,shipperhq`. Unset offers none. Needs `SHIPPING_TOKEN_KEY`; works with or without a platform provider |

Each service is switched on by name once it has been tried against the
vendor's live API with a real merchant account (the runbook on AGL-3632).
Tracking webhooks are per workspace, verified with that workspace's own
secret: `POST /api/shipping/webhooks/sendcloud?org=…` (Sendcloud's secret
key) and `POST /api/shipping/webhooks/easyship?org=…` (the Easyship webhook
secret key the merchant pastes). A label file a service serves only to an
authenticated caller is served at `GET /api/shipping/labels/file`, opened by
a token only that label carries.

Merchant-owned carrier accounts on the platform's provider: Shippo connects
UPS and FedEx with the account-holder form; EasyPost connects every carrier
type its `GET /carrier_types` lists without a custom workflow (DHL Express,
Canada Post and others) with that carrier's own credential fields.
