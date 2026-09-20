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

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'

/**
 * A plugin that owns the tenant's tax rule, standing in for the one that does.
 *
 * Bookings prices a charge by asking the tax-profile contract and imports no
 * storefront, so its specs stand an owner up the way the loader would. The
 * rule here is the contract's, as `plugin-tax-profile.ts` states it: exclusive,
 * rounded to the cent, and zero for a rate that is absent, not positive or
 * above a hundred. What these specs certify is that bookings ASKS the owner and
 * charges and records what it is told. That the REAL owner answers the same,
 * and is registered wherever a booking is priced or confirmed, is held where
 * both plugins can be reached: `tax-profile-is-registered.spec.ts` in each app.
 */
export function standInTaxProfile(): void {
  resetPluginServicesForTests()
  registerPluginTaxProfile(
    {
      flatTax: (rate, chargeCents, fallbackLabel) => {
        const source = (rate ?? {}) as { pct?: unknown; label?: unknown }
        const pct = Number(source.pct)
        const usable = Number.isFinite(pct) && pct > 0 && pct <= 100
        const taxCents = usable ? Math.round((chargeCents * pct) / 100) : 0
        if (!(taxCents > 0)) return { taxCents: 0, label: '', pct: 0 }
        return {
          taxCents,
          label: String(source.label || fallbackLabel).slice(0, 120),
          pct,
        }
      },
      // Read off the settled payment, never restated by the caller: automatic
      // when the processor computed it, manual when the caller added a line.
      taxModeOf: (settledPayment, manualTaxCents = 0) => {
        const source = settledPayment as {
          automatic_tax?: { enabled?: unknown }
          total_details?: { amount_tax?: unknown }
        } | null
        if (source?.automatic_tax?.enabled === true) {
          return Number(source.total_details?.amount_tax) > 0
            ? 'stripe-automatic'
            : 'none'
        }
        return manualTaxCents > 0 ? 'manual' : 'none'
      },
    },
    { pluginId: 'tax-owner' },
  )
}
