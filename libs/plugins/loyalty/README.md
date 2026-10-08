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

None. No outside vendor and no environment variable: each store's program is
off until its merchant turns it on under **Products → Promotions → Rewards**.

## Storage

Server-only, under `orgs/{orgId}`: `loyaltyPrograms/{hostId}`,
`loyaltyMembers/{hostId}__{memberKey}`, `loyaltyCodes/{hostId}__{code}`,
`loyaltyLedger/{hostId}__{entryKey}`,
`loyaltyRedemptions/{hostId}__{orderId}__{memberKey}` and
`loyaltyReferralClaims/{hostId}__{memberKey}`. The Firestore rules refuse
every client.

Smile.io and Yotpo connectors are a later phase with their own issue.
