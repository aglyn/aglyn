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

import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { PHONE_ADDON_KEY, PHONE_FEATURE, PHONE_PERMISSIONS, PHONE_PLUGIN_ID } from './constants/bundle-common'
import { PHONE_INCLUDED_TEXTS_PER_UNIT, PHONE_TEXTS_QUOTA } from './constants/usage'

/**
 * Phone's DECLARATIONS (AGL-4251), loaded by both apps before any surface:
 * the add-on and what one unit of it switches on and includes, and the two
 * permission keys. Nothing here reaches Firestore, Twilio or React.
 *
 * One unit of the `phone` add-on switches the `phone` feature on and adds
 * the included texts to the texts quota, on every plan that sells it. Calls
 * within the US and Canada are unlimited, so there is no minutes quota. The price is
 * core's (`PHONE_ADDON_MONTHLY_USD`), and which plans sell it is core's
 * add-on table; this names keys and the pool.
 */
const PER_UNIT_EVERY_PLAN = (value: number) => ({
  free: value,
  starter: value,
  pro: value,
  enterprise: value,
})

let declared = false

export function registerPhoneDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginPermissions(PHONE_PERMISSIONS)
  registerPluginEntitlements({
    pluginId: PHONE_PLUGIN_ID,
    seatAddons: [
      {
        key: PHONE_ADDON_KEY,
        label: 'Phone',
        maxUnits: 1,
        quota: { key: PHONE_TEXTS_QUOTA, perUnitByPlan: PER_UNIT_EVERY_PLAN(PHONE_INCLUDED_TEXTS_PER_UNIT) },
        features: [PHONE_FEATURE],
        soldOn: (plan) => plan === 'starter' || plan === 'pro',
      },
    ],
  })
}

registerPhoneDeclarations()
