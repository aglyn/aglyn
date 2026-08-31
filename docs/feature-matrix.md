# Aglyn — Feature Matrix

**Generated. Do not hand-edit.** Run `npx tsx tools/scripts/gen-feature-matrix.mts`
after changing `PLAN_ENTITLEMENTS`, and commit both copies.

This table is a VIEW of `libs/aglyn/src/lib/app-utils/plan-entitlements.ts` —
the object the product actually enforces at runtime. It is not an independent
record and must never be edited to say something the code does not.

> **Why this exists.** The pricing docs tracked list prices, the transaction-fee
> ladder and the metered unit rates, but nothing owned the feature matrix. So
> when `mediaCdn` was gated to paid tiers, the row was published on
> `aglyn.com/pricing` and drawn in Figma with no document in Pricing &
> Packaging saying so — there was nothing to reconcile the live table against.
> A reader who wanted to know what Free includes had to read TypeScript.

**Change control.** A feature moving between plans is a packaging change and
takes a Pricing Decision Log entry, exactly as a price move does. Regenerating
this file is the last step, not the decision.

| Feature | Free | Starter | Pro | Business | Scale | Advanced | Agency | Enterprise |
|---|---|---|---|---|---|---|---|---|
| `abTesting` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `abandonedCart` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `actions` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `aiAssist` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `apiAccess` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `bookings` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `commerce` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `commerceAnalytics` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contentGating` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customDomain` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customSendingDomain` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dataStore` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dropshipRouting` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `eventCalendar` | — | — | — | — | — | — | — | — |
| `giftCards` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `interactions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `marketingOverlays` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `marketplaceSelling` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mediaCdn` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `multilingual` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pos` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `productReviews` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `redirects` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `removeBranding` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reusableComponents` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scheduledPublishing` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `screenAnalytics` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `siteExport` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ssoEnabled` | — | — | — | — | — | — | — | ✓ |
| `storefrontSubscriptions` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `versioning` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `videoMedia` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `webhooks` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `whiteLabel` | — | — | — | — | — | — | ✓ | ✓ |
| `workflows` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

_35 features across 8 plans._
