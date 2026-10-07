# @aglyn/plugins-post-purchase

What happens after a sale (AGL-3635): parcel tracking through **AfterShip**,
package protection at checkout through **Route**, and order and tracking
experiences through **Narvar** — each with the merchant's own account.

It never imports the commerce plugin. It reaches commerce's sales through
core seams only:

- `core.checkout-extras` (`plugin-checkout-extras.ts`): the Route premium is
  offered at the cart and charged as an untaxed line, at Route's price
  (`PROTECTION_MARKUP_CENTS` is 0, so Aglyn adds nothing and takes no
  platform fee on it).
- `core.tracking-pages` (`plugin-tracking-pages.ts`): the guest order-status
  page links each parcel to the merchant's Narvar or AfterShip page.
- commerce's order events (`order.paid`, `order.fulfilled`,
  `order.refunded`, `order.cancelled`), subscribed by name: opens and cancels
  the Route policy, tells Route and AfterShip each parcel, sends Narvar the
  whole order.
- `core.shipment-records`: AfterShip's signed webhook records tracking on
  the order the same way a carrier label does.

## Configuration

Hidden everywhere until the deployment sets both:

| variable | what |
| -- | -- |
| `POST_PURCHASE_VENDORS` | the services offered, comma separated: `aftership`, `route`, `narvar` |
| `POST_PURCHASE_TOKEN_KEY` | 32 random bytes, base64: seals every credential a merchant connects (a comma list rotates) |
| `ROUTE_API_BASE` | optional; Route's sandbox root for a test deployment |
| `NARVAR_API_BASE` | optional; Narvar's API root |

Storage: `orgs/{orgId}/postPurchaseHostSettings/{hostId}` and
`orgs/{orgId}/postPurchaseOrders/{hostId}__{recordId}`, server-only.
