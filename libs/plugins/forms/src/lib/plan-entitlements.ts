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

// Types only: the manifest generator loads this module on its own to compile
// the plan figures, so nothing here may reach a core module at runtime.
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginPlanEntitlementsDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-plan-entitlements'

/**
 * THE FORMS PLUGIN'S PLAN BAND (AGL-3080): the form submissions each plan
 * includes a month, per site. Compiled into core's `PLAN_ENTITLEMENTS` by the
 * manifest generator (`register.planEntitlements`); this is where the figure
 * is written, beside the reasoning that sized it.
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /**
     * Form submissions accepted per calendar month, per site (Forms & Lead
     * Capture). The org-wide band is this times `hostLimit`.
     *
     * Not the same dimension as `formsPerHost`, which counts the saved form
     * CATALOG rather than the replies: only this one is tiered, metered and
     * part of a charged price.
     */
    formSubmissionsPerMonth?: number
  }
}

/** The form submissions each plan includes a month, per site. */
export const FORM_SUBMISSIONS_PER_MONTH_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  // A `Form` node placed on a page needs no saved definition to collect, so
  // Free — which has no form catalog — still spends this band on its replies.
  free: 20,
  starter: 200,
  pro: 1000,
  business: 5000,
  scale: 10000,
  advanced: 10000,
  // FINITE, where every other capacity row on this tier is unbounded. The
  // band is multiplied by `hostLimit` to get the org-wide band, so at 100
  // hosts an unbounded figure was not merely large — it made this tier's cost
  // model unbounded, and an unbounded term reads as ZERO in any analysis that
  // scores an absent band as nothing. That is how it stayed invisible: the
  // biggest line item on the most expensive self-serve plan, contributing 0
  // to every total.
  //
  // Metering makes it safe to bound. `meteredInfraPassThrough` is true here,
  // so submissions past the band BILL at the pass-through rate rather than
  // being refused — a merchant's lead form does not stop working at the band.
  agency: 10000,
  enterprise: 20_000,
}

/** The forms plugin's plan figures, for the manifest generator. */
export function formsPlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'formSubmissionsPerMonth',
        label: 'Form subs / mo',
        byPlan: FORM_SUBMISSIONS_PER_MONTH_BY_PLAN,
      },
    ],
  }
}
