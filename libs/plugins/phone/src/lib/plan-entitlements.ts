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

declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /** Call minutes a month the workspace's Phone add-on includes (0 without it). */
    phoneMinutesPerMonth?: number
    /** Text segments a month the workspace's Phone add-on includes (0 without it). */
    phoneTextsPerMonth?: number
  }
  interface PluginEntitlementFeatures {
    /** Aglyn Phone: a business number, texts and calls. Only the add-on (or a staff override) switches it on. */
    phone?: boolean
  }
}

const NONE: Readonly<Record<OrgPlan, number>> = { free: 0, starter: 0, pro: 0, enterprise: 0 }

/**
 * THE PHONE PLUGIN'S PLAN FIGURES (AGL-4251). No plan includes Phone: it is a
 * $15/mo add-on, and one unit of it adds the pool (`declarations.ts`). So
 * every plan includes nothing here, and the add-on fold is what raises it.
 */
export function phonePlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      { key: 'phoneMinutesPerMonth', label: 'Phone min / mo', byPlan: NONE },
      { key: 'phoneTextsPerMonth', label: 'Phone texts / mo', byPlan: NONE },
    ],
    features: [
      { key: 'phone', label: 'Phone', byPlan: { free: false, starter: false, pro: false, enterprise: false } },
    ],
  }
}
