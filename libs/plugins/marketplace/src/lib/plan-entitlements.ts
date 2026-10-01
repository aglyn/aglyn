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
 * THE MARKETPLACE'S PLAN TERMS (AGL-3080): which plans may sell on the
 * marketplace, and the take rate on a sale. Compiled into core's
 * `PLAN_ENTITLEMENTS` by the manifest generator
 * (`register.planEntitlements`), so the pricing tables and the checkout read
 * the figures they always have.
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /**
     * Platform take rate % on the org's MARKETPLACE listing sales (AGL-46,
     * resolved from entitlements per AGL-1543): 20 on paid plans, 30 on
     * free. Distinct from the storefront `transactionFee*Pct` — this is
     * Aglyn's cut of a marketplace sale, priced off the SELLER org.
     */
    marketplaceFeePct?: number
  }
  interface PluginEntitlementFeatures {
    /** Sell listings on the marketplace (AGL-46). */
    marketplaceSelling?: boolean
  }
}

/** The take rate on a marketplace sale, per plan of the SELLER org. */
export const MARKETPLACE_FEE_PCT_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  // Marketplace take rate (AGL-46/1543): free-plan sellers pay a higher
  // share. `marketplaceSelling` is false here, so this rate only prices an
  // org GRANTED selling via a per-org feature override — and any org whose
  // dead subscription resolved it down to free.
  free: 30,
  starter: 20,
  pro: 20,
  business: 20,
  scale: 20,
  advanced: 20,
  agency: 20,
  enterprise: 20,
}

/** Which plans may sell on the marketplace: Pro and up. */
export const MARKETPLACE_SELLING_BY_PLAN: Readonly<Record<OrgPlan, boolean>> = {
  free: false,
  starter: false,
  pro: true,
  business: true,
  scale: true,
  advanced: true,
  agency: true,
  enterprise: true,
}

/** The marketplace's plan figures, for the manifest generator. */
export function marketplacePlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'marketplaceFeePct',
        label: 'Marketplace fee %',
        byPlan: MARKETPLACE_FEE_PCT_BY_PLAN,
        // A percentage of a sale, not a band: an uncapped comp never lifts it.
        price: true,
      },
    ],
    features: [
      {
        key: 'marketplaceSelling',
        label: 'Sell on the marketplace',
        byPlan: MARKETPLACE_SELLING_BY_PLAN,
      },
    ],
  }
}
