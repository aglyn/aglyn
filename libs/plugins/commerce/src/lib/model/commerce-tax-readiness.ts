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

/*==========================================
 * WHETHER SALES TAX LETS SHOPPERS CHECK OUT (AGL-4245)
 *
 * Two tax states refuse every storefront checkout, and the owner was told of
 * neither: a store that never chose how it handles sales tax
 * (`storefrontTaxDecision` → `undecided`), and a store on its own Stripe
 * account (direct charges) that chose Stripe Tax while Stripe Tax is not on
 * in that account (`sellerStripeTaxActive`). The console's Taxes and
 * Payments cards, and the route that answers them
 * (`server/tax-readiness.ts`), read the same answer from here.
 *=========================================*/

/** What Stripe Tax still needs on the store's own Stripe account. */
export type StripeTaxSetupStep = 'head-office' | 'tax-code' | 'registration'

/** Stripe Dashboard → Settings → Tax: the business address and the default tax category. */
export const STRIPE_TAX_SETTINGS_DASHBOARD_URL = 'https://dashboard.stripe.com/settings/tax'
/** Stripe Dashboard → Tax → Registrations: the places the business collects tax. */
export const STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL = 'https://dashboard.stripe.com/tax/registrations'

/** The store's own Stripe Tax, as read from its Stripe account. */
export interface SellerStripeTaxStatus {
  /** Stripe answered. False when the read failed, which checkout treats as not on. */
  readable: boolean
  /** Stripe's `tax/settings` status is `active`: checkout may ask Stripe Tax. */
  active: boolean
  /** What keeps the status from `active`, in the order an owner does it. */
  missing: StripeTaxSetupStep[]
  /**
   * Whether the account has at least one active tax registration. Null when
   * that list could not be read. Not part of `active`: Stripe Tax turns on
   * without one, and then adds no tax anywhere.
   */
  hasRegistration: boolean | null
}

const STEP_ORDER: readonly StripeTaxSetupStep[] = ['head-office', 'tax-code', 'registration']

/**
 * Reads Stripe's `GET /v1/tax/settings` answer (and whether the account has
 * any active registration) into the steps an owner can act on. The steps come
 * from `status_details.pending.missing_fields` where Stripe names them, and
 * from the settings themselves (no head office, no default tax code) where it
 * does not, so a pending account never shows an empty list.
 */
export function stripeTaxStatusFromSettings(
  settings: unknown,
  hasRegistration: boolean | null,
): SellerStripeTaxStatus {
  if (!settings || typeof settings !== 'object') {
    return { readable: false, active: false, missing: [], hasRegistration }
  }
  const read = settings as {
    status?: unknown
    head_office?: { address?: unknown } | null
    defaults?: { tax_code?: unknown } | null
    status_details?: { pending?: { missing_fields?: unknown } | null } | null
  }
  const active = read.status === 'active'
  const missing = new Set<StripeTaxSetupStep>()
  if (!active) {
    const named = read.status_details?.pending?.missing_fields
    for (const field of Array.isArray(named) ? named : []) {
      const text = String(field)
      if (text.startsWith('head_office')) missing.add('head-office')
      else if (text.includes('tax_code')) missing.add('tax-code')
    }
    if (!read.head_office || !read.head_office.address) missing.add('head-office')
    if (!read.defaults?.tax_code) missing.add('tax-code')
    if (hasRegistration === false) missing.add('registration')
  }
  return {
    readable: true,
    active,
    missing: STEP_ORDER.filter((step) => missing.has(step)),
    hasRegistration,
  }
}

/** Why checkout is refusing every shopper because of sales tax, or null. */
export type CheckoutTaxBlock = 'tax-undecided' | 'stripe-tax-not-active'

/**
 * The same two refusals checkout makes, from what the console can be told:
 * the saved tax mode (null when none was ever saved), whether the store sells
 * on its own Stripe account, and that account's Stripe Tax.
 */
export function checkoutTaxBlock(input: {
  mode: string | null | undefined
  direct: boolean
  stripeTax: SellerStripeTaxStatus | null
}): CheckoutTaxBlock | null {
  const mode = input.mode
  if (mode !== 'manual' && mode !== 'stripe' && mode !== 'none') return 'tax-undecided'
  if (mode === 'stripe' && input.direct && !input.stripeTax?.active) return 'stripe-tax-not-active'
  return null
}

/** What `GET /api/commerce/tax-readiness` answers. */
export interface StoreTaxReadiness {
  /** The saved tax mode; null when none was ever saved. */
  mode: 'manual' | 'stripe' | 'none' | null
  /** The store takes payments on its own Stripe account (direct charges). */
  direct: boolean
  /** That account's Stripe Tax; null when the store is not on its own account. */
  stripeTax: SellerStripeTaxStatus | null
  /** Whether checkout is refusing every shopper because of sales tax. */
  blocked: CheckoutTaxBlock | null
  /** When a shopper was last refused for that reason, if one was. */
  refusedAtMs: number | null
}

/** One step of the Stripe Tax setup, as the Taxes card lists it. */
export const STRIPE_TAX_STEP_TEXT: Readonly<Record<StripeTaxSetupStep, string>> = {
  'head-office': 'Add your business address in Stripe Tax.',
  'tax-code': 'Pick a default product tax category in Stripe Tax.',
  registration: 'Add at least one place you collect tax.',
}

/** Where in the Stripe Dashboard one step is done. */
export function stripeTaxStepHref(step: StripeTaxSetupStep): string {
  return step === 'registration'
    ? STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL
    : STRIPE_TAX_SETTINGS_DASHBOARD_URL
}

/** What the owner is told when a shopper was refused, by reason. */
export function checkoutTaxRefusalNotice(reason: CheckoutTaxBlock): { title: string; body: string } {
  return reason === 'tax-undecided'
    ? {
        title: 'A shopper couldn’t check out on {site}',
        body:
          'Checkout on {site} is off because the store hasn’t chosen how it handles sales tax. ' +
          'Choose an option in Products → Taxes and save, and shoppers can check out again.',
      }
    : {
        title: 'A shopper couldn’t check out on {site}',
        body:
          'Checkout on {site} is off because the store uses Stripe Tax, and Stripe Tax isn’t on in your ' +
          'Stripe account yet. Open Products → Taxes to see what’s left, or pick another tax option there.',
      }
}
