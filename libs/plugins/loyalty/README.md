# @aglyn/plugins-loyalty

Built-in rewards for a store (AGL-3640): **points** earned on online and
register sales, spent at checkout and at the register; **referral codes** that
take money off a friend's first order and earn the member store credit; and
**store credit** a merchant gives by hand, beside commerce's gift cards.

It never imports the commerce plugin. It reaches commerce's sales through core
seams only:

- `core.checkout-credits` (`plugin-checkout-credits.ts`): the `loyalty.rewards`
  provider. Commerce's cart resolves and HOLDS a rewards or referral code before
  Stripe is asked, and the webhook takes the hold inside the transaction that
  writes the order. The register stages and debits the account inside the
  sale's transaction, reverses it on a void, and restores it on a register
  return. Staff can look a member up by email at the register.
- commerce's order events (`order.paid`, `order.refunded`,
  `order.cancelled`), subscribed by name: earn once per order, reverse earned
  points and give back online redemptions to a cumulative target on refunds.
- commerce's `commercePromotions` and `orderDetail` console zones.

Money is integer cents and points whole numbers. Every write is a transaction
keyed by what caused it, so a retried webhook, event or press moves nothing
twice.

## Configuration

The built-in program needs none: each store's program is off until its
merchant turns it on under **Products → Promotions → Rewards**.

## Smile.io and Yotpo Loyalty (AGL-3677)

A merchant may connect their OWN Smile.io or Yotpo Loyalty account in place of
the built-in points. Neither needs an app of Aglyn's: Smile.io takes a private
API key the merchant creates (Plus and Enterprise plans), Yotpo its account
GUID and API key. One deployment variable:

- `LOYALTY_CONNECTORS_TOKEN_KEY` — 32 random bytes, base64 (a `secret-box`
  keyring, `id:base64,…`, current first, to rotate). Every stored vendor key is
  sealed under it. Without it the **Rewards account** card draws nothing and
  its guide stays unlisted.

One program at a time. While an account is connected, the built-in program
awards no points, welcome points or referral rewards of its own: the same
earn, reverse, redeem, void, give-back and hand-adjust movements are written
to the ledger as before, and each also writes its twin in `loyaltySync`
(same id, same commit). `connector-sync.ts` sends each row once — a
transactional claim, then the call, then `synced`; a sender that died mid-call
is found again by the reference it left in the vendor's own history. A member's
balance is the vendor's, refreshed into the member document whenever a code or
a cashier names them. Test-mode sales move no real points.

## Storage

Server-only, under `orgs/{orgId}`: `loyaltyPrograms/{hostId}`,
`loyaltyMembers/{hostId}__{memberKey}`, `loyaltyCodes/{hostId}__{code}`,
`loyaltyLedger/{hostId}__{entryKey}`,
`loyaltyRedemptions/{hostId}__{orderId}__{memberKey}` and
`loyaltyReferralClaims/{hostId}__{memberKey}`, and for a connected account
`loyaltyConnections/{hostId}` and `loyaltySync/{hostId}__{entryKey}`. The
Firestore rules refuse every client.
