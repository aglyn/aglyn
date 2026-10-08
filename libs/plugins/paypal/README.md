# @aglyn/plugins-paypal

PayPal and Venmo for the stores the commerce plugin runs (AGL-3630), through
PayPal's partner (multiparty) integration. Reached with `fetch` alone.

## How it meets commerce

It never imports the commerce plugin, and commerce never imports it. Core's
`@aglyn/aglyn/plugin-manager/plugin-payment-providers` carries everything:

- this plugin registers a payment provider (`paypal`): whether it can take a
  sale, opening a checkout for an amount it is handed, and refunds;
- a seller registers a checkout owner for each kind of checkout it opens,
  and is called back to approve what the buyer chose, to fulfil once paid,
  to release what an abandoned checkout held, and on refunds and disputes.

The buyer pays on this plugin's own page (`/api/paypal/pay?c=…`, on the host
they came from), which loads PayPal's buttons — Venmo's where PayPal says the
buyer is eligible — so no storefront page loads PayPal's script.

## Money

Integer minor units throughout; PayPal's decimal strings are formatted and
parsed as text. Every order create, capture and refund carries a
`PayPal-Request-Id`; a checkout is captured under a transaction-held claim,
so the buyer's return and PayPal's `CHECKOUT.ORDER.APPROVED` webhook capture
it once. The platform fee is the seller's transaction fee, taken with
`payment_instruction.platform_fees`, and refunds return it in proportion.

## Configuration

Hidden until EVERY variable is set — and they are set only once PayPal's
partner application is approved and PayPal is on the published Subprocessors
list (Google Doc first):

| Variable | What it is |
| -- | -- |
| `PAYPAL_ENVIRONMENT` | `sandbox` or `live`; must match the card account's mode |
| `PAYPAL_CLIENT_ID` | The partner REST app's client id |
| `PAYPAL_CLIENT_SECRET` | The partner REST app's secret |
| `PAYPAL_PARTNER_MERCHANT_ID` | The partner account's PayPal merchant id |
| `PAYPAL_PARTNER_ATTRIBUTION_ID` | The partner's BN code |
| `PAYPAL_WEBHOOK_ID` | The webhook registered for `POST /api/paypal/webhook` on the console's host |

Webhook events to subscribe: `CHECKOUT.ORDER.APPROVED`,
`PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`,
`PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`,
`PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
`CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`,
`MERCHANT.ONBOARDING.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED`,
`CUSTOMER.MERCHANT-INTEGRATION.SELLER-EMAIL-CONFIRMED`,
`CUSTOMER.MERCHANT-INTEGRATION.CAPABILITY-UPDATED`,
`CUSTOMER.MERCHANT-INTEGRATION.PRODUCT-SUBSCRIPTION-UPDATED`.
