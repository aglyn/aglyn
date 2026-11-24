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
 * WHAT THE PAYMENTS CARD SAYS ABOUT STRIPE SETUP (AGL-4245), from the owner's
 * profile as the connect route and `account.updated` keep it
 * (`merchantRequirementsSummary`). Pure, so the words are tested apart from
 * the card.
 */

/**
 * The query parameter Stripe's onboarding links come back with, on the
 * Payments section: `done` when the owner finished or left the form,
 * `refresh` when the link had expired or was already opened.
 */
export const CONNECT_RETURN_PARAM = 'connect'

/** How long a `refresh` return counts as "already continued once", so an expired link never loops. */
export const CONNECT_REFRESH_GUARD_MS = 2 * 60 * 1000

/** The profile fields read here. Every one may be absent on an older profile. */
export interface PaymentsSetupProfile {
  stripeAccountId?: unknown
  stripeChargesEnabled?: unknown
  stripePayoutsEnabled?: unknown
  stripeDetailsSubmitted?: unknown
  stripeRequirementsDueCount?: unknown
  stripeRequirementsPastDueCount?: unknown
  stripeRequirementsDeadlineMs?: unknown
}

/** A notice the card shows, with whether it offers "Continue setup". */
export interface PaymentsSetupNotice {
  severity: 'success' | 'info' | 'warning' | 'error'
  text: string
  /** The notice names something only Stripe's form can fix. */
  continueSetup: boolean
}

const count = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** A deadline as people read it: `March 4, 2027`. */
export function paymentsDeadlineText(ms: number, locale?: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * The standing notice when Stripe needs more from an owner who has already
 * been through its form once, or null when nothing is due.
 *
 * "To keep taking payments" when card payments are already off, else "to
 * keep payouts running": Stripe does not say ahead of time which of the two
 * a missed deadline stops, so the notice names the one that is already
 * affected, or payouts while payments still work.
 */
export function paymentsRequirementsNotice(
  profile: PaymentsSetupProfile | null | undefined,
  options: { now?: number; locale?: string } = {},
): PaymentsSetupNotice | null {
  if (!profile?.stripeAccountId || profile.stripeDetailsSubmitted !== true) return null
  const due = count(profile.stripeRequirementsDueCount)
  const pastDue = count(profile.stripeRequirementsPastDueCount)
  if (!due && !pastDue) return null
  const now = options.now ?? Date.now()
  const deadline = Number(profile.stripeRequirementsDeadlineMs)
  const by =
    !pastDue && Number.isFinite(deadline) && deadline > now
      ? ` by ${paymentsDeadlineText(deadline, options.locale)}`
      : ''
  const what =
    profile.stripeChargesEnabled === true ? 'keep payouts running' : 'keep taking payments'
  return {
    severity: pastDue ? 'error' : 'warning',
    text: `Stripe needs more details${by} to ${what}.`,
    continueSetup: true,
  }
}

/**
 * The result shown on the Payments section after Stripe sends the owner back
 * (`?connect=done`), read from the live profile, so it changes by itself when
 * Stripe's update lands.
 */
export function paymentsReturnResult(
  profile: PaymentsSetupProfile | null | undefined,
  ready: boolean,
): PaymentsSetupNotice {
  const due =
    count(profile?.stripeRequirementsDueCount) + count(profile?.stripeRequirementsPastDueCount)
  if (ready && profile?.stripePayoutsEnabled !== false && !due) {
    return {
      severity: 'success',
      text: 'Payments are set up. Your store is ready to take payments.',
      continueSetup: false,
    }
  }
  if (ready && profile?.stripePayoutsEnabled === false && !due) {
    return {
      severity: 'info',
      text:
        'Your store can take payments. Stripe is still checking your details ' +
        'before it sends payouts, and this updates by itself when it is done.',
      continueSetup: false,
    }
  }
  if (ready) {
    return {
      severity: 'warning',
      text: 'Your store can take payments, and Stripe still needs a few more details.',
      continueSetup: true,
    }
  }
  if (profile?.stripeDetailsSubmitted === true && !due) {
    return {
      severity: 'info',
      text:
        'Stripe is checking your details. This updates by itself when it is ' +
        'done, and there is nothing more you need to do right now.',
      continueSetup: false,
    }
  }
  return {
    severity: 'warning',
    text: 'Stripe still needs a few details before your store can take payments.',
    continueSetup: true,
  }
}
