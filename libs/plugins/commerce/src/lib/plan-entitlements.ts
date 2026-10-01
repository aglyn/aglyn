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
 * COMMERCE'S PLAN GATES (AGL-3080): the storefront features that start above
 * the entry tiers. Compiled into core's `PLAN_ENTITLEMENTS` by the manifest
 * generator (`register.planEntitlements`), so the plan comparison and every
 * gate read the answers they always have.
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementFeatures {
    /** Recurring storefront subscription products (AGL-303). */
    storefrontSubscriptions?: boolean
    /** Gift cards & store credit (AGL-322). */
    giftCards?: boolean
    /** Commerce analytics dashboard (AGL-327). */
    commerceAnalytics?: boolean
  }
}

/** Business and up. */
const FROM_BUSINESS: Readonly<Record<OrgPlan, boolean>> = {
  free: false,
  starter: false,
  pro: false,
  business: true,
  scale: true,
  advanced: true,
  agency: true,
  enterprise: true,
}

/** Pro and up. */
const FROM_PRO: Readonly<Record<OrgPlan, boolean>> = {
  ...FROM_BUSINESS,
  pro: true,
}

/** Commerce's plan gates, for the manifest generator. */
export function commercePlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    features: [
      {
        key: 'storefrontSubscriptions',
        label: 'Storefront subscriptions',
        byPlan: FROM_BUSINESS,
      },
      { key: 'giftCards', label: 'Gift cards', byPlan: FROM_BUSINESS },
      {
        key: 'commerceAnalytics',
        label: 'Commerce analytics',
        byPlan: FROM_PRO,
      },
    ],
  }
}
