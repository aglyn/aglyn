# @aglyn/plugins-review-platforms

Trustpilot and Yotpo Reviews invitations for the commerce plugin's orders
(AGL-3699), each with the merchant's own account. The store's built-in product
reviews stay the default and stay the reviews its product pages show.

- **Trustpilot, by BCC** — the store's own Trustpilot invitation address
  (`…@invite.trustpilot.com`) is blind-copied on one buyer email per order
  (shipped or delivered, as chosen), with the `application/json+trustpilot`
  data block Trustpilot reads. Needs nothing of the deployment. Rides core's
  `core.order-email-copies` contract, which commerce asks before each buyer
  email.
- **Trustpilot, by API** — the Invitations API with the merchant's own API key
  and secret, on `order.fulfilled` or `order.delivered`.
- **Yotpo Reviews** — Yotpo's Core API with the merchant's app key and secret
  key: each order is sent, fulfilled, on its first `order.fulfilled`, and
  Yotpo sends the review request. Not the loyalty plugin's Yotpo connector,
  which is Yotpo Loyalty & Referrals, a different product and key.

Every invitation is refused for a test-mode, canceled or fully refunded order,
an order with no email, and a buyer the site may not market to (the campaign
decision: consent basis plus both suppression lists). One invitation per
order per service, claimed in a transaction.

## Environment

- `REVIEW_PLATFORMS_TOKEN_KEY` — 32 random bytes, base64 (a keyring rotates),
  sealing the Trustpilot API key and secret and the Yotpo secret key. Unset,
  the Trustpilot API mode and the Yotpo card are hidden; the BCC address is
  always offered.

## Records

Server-only: `orgs/{orgId}/reviewPlatformsHostSettings/{hostId}` and
`orgs/{orgId}/reviewPlatformsInvitations/{hostId}__{recordId}` (no personal
data). The Firestore rules refuse every client.
