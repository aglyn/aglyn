/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The storefront payment methods a merchant chooses between (AGL-3629).
 *
 * ## Who decides what a shopper sees
 *
 * Every storefront charge is a DESTINATION charge with no `on_behalf_of`, so
 * the PLATFORM is the merchant of record and Stripe offers the methods the
 * platform's payment method configuration turns on ("dynamic payment
 * methods"), filtered by currency, amount, the shopper's country and device.
 * No session pins `payment_method_types`. A merchant therefore cannot ADD a
 * method the platform does not offer — they can only take one away, and that
 * is what the two levers below do:
 *
 *   - `excluded_payment_method_types` on the Checkout Session, for every method
 *     Stripe lets a session exclude. Measured accepted at both the account
 *     default API version and the native checkout's pinned dahlia version, so
 *     it applies to the in-page checkout AND the hosted Stripe page alike.
 *   - The Payment Element's `wallets` option for Apple Pay, Google Pay and
 *     Link, which Stripe documents as NOT excludable per session. Link is also
 *     hidden on the session with `wallet_options[link][display]=never`, which
 *     reaches the hosted page; Apple Pay and Google Pay on a hosted Stripe page
 *     follow the device and cannot be hidden per merchant.
 *
 * ## Why toggling a method never moves a fee
 *
 * `application_fee_amount` is priced against the dearest method the platform
 * could offer (`SALE_PROCESSING_PERCENT`, the BNPL rate), because the shopper
 * picks how to pay after the fee is fixed. Every method here costs Stripe that
 * much or less, so turning one off or on changes what a shopper may choose and
 * never what the platform recovers.
 */

/** A method the merchant may switch off (or, for crypto, on). */
export type StorefrontPaymentMethodId =
  | 'apple_pay'
  | 'google_pay'
  | 'link'
  | 'klarna'
  | 'afterpay_clearpay'
  | 'affirm'
  | 'cashapp'
  | 'amazon_pay'
  | 'crypto'

export type StorefrontPaymentMethodKind = 'wallet' | 'bnpl' | 'crypto'

/** How a toggle reaches Stripe. */
export type StorefrontPaymentMethodControl =
  /** The Payment Element's `wallets` option (and, for Link, the session). */
  | 'wallet'
  /** `excluded_payment_method_types` on the Checkout Session. */
  | 'exclude'

export interface StorefrontPaymentMethodSpec {
  id: StorefrontPaymentMethodId
  label: string
  kind: StorefrontPaymentMethodKind
  control: StorefrontPaymentMethodControl
  /**
   * On when the merchant has never chosen. Every method that was already
   * reaching shoppers before AGL-3629 defaults on, so saving nothing changes
   * nothing; crypto, which settles differently and cannot be disputed,
   * defaults off and is the merchant's to opt into.
   */
  defaultOn: boolean
  /**
   * The connected-account capability Stripe asks platforms to request before
   * the method is accepted for that account. Absent for the card wallets,
   * which ride `card_payments`.
   */
  capability?: string
  /** The platform payment method configuration's key for this method. */
  configurationKey: string
  /** What a shopper needs, in a sentence the settings card shows. */
  requirements: string
  /** Amount and currency limits, as Stripe publishes them for US accounts. */
  limits: string
  /** Lowest charge Stripe offers it for, in USD cents, when published. */
  minCents?: number
  /** Highest charge Stripe offers it for, in USD cents, when published. */
  maxCents?: number
  /** False where Stripe does not offer it in a subscription-mode session. */
  subscriptions: boolean
  /** Shown on a registered domain only (Apple Pay must be; the rest benefit). */
  needsDomain: boolean
}

/**
 * The catalog, in the order the settings card lists it. Limits are Stripe's
 * published US figures (docs.stripe.com/payments/buy-now-pay-later and each
 * method's page, read 2026-10-07); Stripe applies them itself, and they are
 * here so a merchant can read why a method did not appear on an order.
 */
export const STOREFRONT_PAYMENT_METHODS: readonly StorefrontPaymentMethodSpec[] = [
  {
    id: 'apple_pay',
    label: 'Apple Pay',
    kind: 'wallet',
    control: 'wallet',
    defaultOn: true,
    configurationKey: 'apple_pay',
    requirements:
      'Safari on a Mac, iPhone or iPad with a card in Apple Wallet. Your site’s domain is registered with Apple Pay for you.',
    limits: 'Same as cards.',
    subscriptions: true,
    needsDomain: true,
  },
  {
    id: 'google_pay',
    label: 'Google Pay',
    kind: 'wallet',
    control: 'wallet',
    defaultOn: true,
    configurationKey: 'google_pay',
    requirements:
      'Chrome or an Android device with a card saved to Google Pay. With Stripe Tax on, Google Pay shows when the checkout collects a shipping address.',
    limits: 'Same as cards.',
    subscriptions: true,
    needsDomain: true,
  },
  {
    id: 'link',
    label: 'Link',
    kind: 'wallet',
    control: 'wallet',
    defaultOn: true,
    configurationKey: 'link',
    requirements: 'Shoppers who saved a card or bank with Link check out in one step.',
    limits: 'Same as cards.',
    subscriptions: true,
    needsDomain: true,
  },
  {
    id: 'klarna',
    label: 'Klarna',
    kind: 'bnpl',
    control: 'exclude',
    defaultOn: true,
    capability: 'klarna_payments',
    configurationKey: 'klarna',
    requirements:
      'US shoppers paying in USD. Pay in full, in 30 days, in 4, or monthly financing.',
    limits: 'From $10; the highest amount depends on the shopper (financing up to $10,000).',
    minCents: 1000,
    subscriptions: true,
    needsDomain: false,
  },
  {
    id: 'afterpay_clearpay',
    label: 'Afterpay',
    kind: 'bnpl',
    control: 'exclude',
    defaultOn: true,
    capability: 'afterpay_clearpay_payments',
    configurationKey: 'afterpay_clearpay',
    requirements: 'US shoppers paying in USD. Pay in 4 interest-free installments.',
    limits: '$1 to $4,000. One-time purchases only.',
    minCents: 100,
    maxCents: 400_000,
    subscriptions: false,
    needsDomain: false,
  },
  {
    id: 'affirm',
    label: 'Affirm',
    kind: 'bnpl',
    control: 'exclude',
    defaultOn: true,
    capability: 'affirm_payments',
    configurationKey: 'affirm',
    requirements:
      'US shoppers paying in USD. Pay in 4, or monthly installments up to 36 months.',
    limits: '$50 to $30,000. One-time purchases only.',
    minCents: 5_000,
    maxCents: 3_000_000,
    subscriptions: false,
    needsDomain: false,
  },
  {
    id: 'cashapp',
    label: 'Cash App Pay',
    kind: 'wallet',
    control: 'exclude',
    defaultOn: true,
    capability: 'cashapp_payments',
    configurationKey: 'cashapp',
    requirements: 'US shoppers with Cash App, paying in USD.',
    limits: 'USD only.',
    subscriptions: true,
    needsDomain: false,
  },
  {
    id: 'amazon_pay',
    label: 'Amazon Pay',
    kind: 'wallet',
    control: 'exclude',
    defaultOn: true,
    capability: 'amazon_pay_payments',
    configurationKey: 'amazon_pay',
    requirements: 'Shoppers pay with the card and address saved to their Amazon account.',
    limits: 'USD only.',
    subscriptions: true,
    needsDomain: true,
  },
  {
    id: 'crypto',
    label: 'Stablecoins (crypto)',
    kind: 'crypto',
    control: 'exclude',
    defaultOn: false,
    capability: 'crypto_payments',
    configurationKey: 'crypto',
    requirements:
      'Shoppers pay in USDC or another supported stablecoin from their crypto wallet; you are paid in USD. Refunds go back to the shopper’s wallet as stablecoins, and these payments cannot be disputed.',
    limits: 'USD only, up to $10,000 per payment.',
    maxCents: 1_000_000,
    subscriptions: true,
    needsDomain: false,
  },
]

/** The merchant's choices, as stored on `hosts/{hostId}/settings/store`. */
export type StorefrontPaymentMethodSettings = Partial<
  Record<StorefrontPaymentMethodId, boolean>
>

export const STOREFRONT_PAYMENT_METHOD_IDS: readonly StorefrontPaymentMethodId[] =
  STOREFRONT_PAYMENT_METHODS.map((method) => method.id)

export function storefrontPaymentMethodSpec(
  id: string,
): StorefrontPaymentMethodSpec | undefined {
  return STOREFRONT_PAYMENT_METHODS.find((method) => method.id === id)
}

/**
 * Keep only booleans under known ids. The settings document is written by the
 * console, so anything else on it — a string, a removed method, a typo — is
 * read as "never chosen" rather than trusted.
 */
export function normalizeStorefrontPaymentMethodSettings(
  raw: unknown,
): StorefrontPaymentMethodSettings {
  const out: StorefrontPaymentMethodSettings = {}
  if (!raw || typeof raw !== 'object') return out
  for (const id of STOREFRONT_PAYMENT_METHOD_IDS) {
    const value = (raw as Record<string, unknown>)[id]
    if (typeof value === 'boolean') out[id] = value
  }
  return out
}

/** Whether the merchant offers a method: their choice, else its default. */
export function isStorefrontPaymentMethodOn(
  settings: StorefrontPaymentMethodSettings | null | undefined,
  id: StorefrontPaymentMethodId,
): boolean {
  const chosen = settings?.[id]
  if (typeof chosen === 'boolean') return chosen
  return storefrontPaymentMethodSpec(id)?.defaultOn ?? false
}

/** `auto` lets Stripe decide from the device; `never` hides the wallet. */
export type StorefrontWalletDisplay = 'auto' | 'never'

/** The Payment Element's `wallets` option, as the browser receives it. */
export interface StorefrontCheckoutWallets {
  applePay: StorefrontWalletDisplay
  googlePay: StorefrontWalletDisplay
  link: StorefrontWalletDisplay
}

export interface StorefrontPaymentMethodControls {
  /** Sent as `excluded_payment_method_types[n]`, in catalog order. */
  excluded: StorefrontPaymentMethodId[]
  /** Handed to the Payment Element. */
  wallets: StorefrontCheckoutWallets
}

/**
 * What one checkout session sends Stripe for the merchant's choices.
 *
 * A method the merchant left on is NOT added anywhere: dynamic payment methods
 * already offer it when the platform does and the order qualifies. Only the
 * methods turned off are named, which is why a merchant who never opened the
 * card produces the same session as before AGL-3629 — except crypto, which is
 * excluded until chosen, and was never offered by the platform before either.
 */
export function resolveStorefrontPaymentMethodControls(
  settings: StorefrontPaymentMethodSettings | null | undefined,
): StorefrontPaymentMethodControls {
  const excluded = STOREFRONT_PAYMENT_METHODS.filter(
    (method) =>
      method.control === 'exclude' && !isStorefrontPaymentMethodOn(settings, method.id),
  ).map((method) => method.id)
  const display = (id: StorefrontPaymentMethodId): StorefrontWalletDisplay =>
    isStorefrontPaymentMethodOn(settings, id) ? 'auto' : 'never'
  return {
    excluded,
    wallets: {
      applePay: display('apple_pay'),
      googlePay: display('google_pay'),
      link: display('link'),
    },
  }
}

/**
 * Write the controls onto a Checkout Session param set. Leaves the params
 * untouched when the merchant hid nothing, so a store with default settings —
 * apart from the crypto opt-in — sends what it always sent.
 */
export function appendStorefrontPaymentMethodParams(
  params: URLSearchParams,
  controls: StorefrontPaymentMethodControls,
): void {
  controls.excluded.forEach((id, index) => {
    params.set(`excluded_payment_method_types[${index}]`, id)
  })
  if (controls.wallets.link === 'never') {
    params.set('wallet_options[link][display]', 'never')
  }
}

/** True when the browser has to be told about a hidden wallet at all. */
export function storefrontWalletsHideAny(wallets: StorefrontCheckoutWallets): boolean {
  return (
    wallets.applePay === 'never' ||
    wallets.googlePay === 'never' ||
    wallets.link === 'never'
  )
}

/**
 * The `wallets` a checkout response carries, as the browser reads it. Anything
 * that is not exactly `'auto'` or `'never'` is dropped, so a malformed or old
 * response shows every wallet rather than breaking the payment form.
 */
export function readStorefrontCheckoutWallets(
  raw: unknown,
): StorefrontCheckoutWallets | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = (key: string): StorefrontWalletDisplay =>
    (raw as Record<string, unknown>)[key] === 'never' ? 'never' : 'auto'
  const wallets: StorefrontCheckoutWallets = {
    applePay: value('applePay'),
    googlePay: value('googlePay'),
    link: value('link'),
  }
  return storefrontWalletsHideAny(wallets) ? wallets : undefined
}
