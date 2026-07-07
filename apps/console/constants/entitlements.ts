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
 * Feature entitlements by plan. STUB until Tenant Billing & SaaS Plans
 * (AGL-38..41) lands real plan data on the tenant/host: everything resolves
 * to allowed so features ship dark-launched, and each gated surface already
 * routes through this check.
 */
export type Entitlement = 'versioning' | 'reusable-components'

export function hasEntitlement(feature: Entitlement): boolean {
  switch (feature) {
    case 'versioning':
    case 'reusable-components':
      // TODO(AGL-38): resolve from the tenant's subscription tier.
      return true
    default:
      return false
  }
}
