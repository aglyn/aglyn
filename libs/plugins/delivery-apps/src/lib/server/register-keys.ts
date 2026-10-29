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
import type { DeliveryGateKind } from './routes'

/*==========================================
 * THE REGISTER'S KEYS DECIDE, NOT THE SITE ROLE (AGL-4047).
 *
 * The delivery queue sits on the POS register, so it answers to the
 * register's own keys, as the register's doors do: "Use the point of sale"
 * (`managePos`) opens the queue, and taking or working one of its orders asks
 * "Sell at the register" (`posSell`) as well, the key the register's sale
 * route asks to record a sale. Accepting records the order as a store sale
 * and takes its items off the shelf; rejecting, marking it ready or picked up
 * and sending a step again are the rest of taking that sale.
 *
 * The keys are commerce's. This plugin names them as strings through the
 * permission catalog and never imports commerce: the member's map comes
 * from `resolveOrgPermissions(uid, { hostId })`, which resolves every
 * registered key for the site.
 *
 * Nobody's access moves by default: both keys are on for the admin and
 * editor tiers and off for author and viewer, exactly the site roles this
 * door used to ask for. A site viewer a role or an override grants the
 * register now works it; a member a role refuses it is now refused.
 *=========================================*/

/** "Use the point of sale": the register itself. */
export const REGISTER_KEY = 'managePos'

/** "Sell at the register": one of `managePos`'s finer keys, which refines it. */
export const REGISTER_SALE_KEY = 'posSell'

/** The register's doors: the queue, and an action on one of its orders. */
export type DeliveryRegisterGateKind = Exclude<DeliveryGateKind, 'settings'>

/** The keys each register door asks, in the order they are asked. */
export const DELIVERY_REGISTER_KEYS: Readonly<Record<DeliveryRegisterGateKind, readonly string[]>> = {
  register: [REGISTER_KEY],
  registerOrder: [REGISTER_KEY, REGISTER_SALE_KEY],
}

/**
 * The first key a member's resolved map does not hold for a register door,
 * or `null` when it holds them all.
 *
 * `managePos` must be held outright. `posSell` refines it: never held
 * without it, and a map that does not carry it at all follows `managePos`
 * (the reading the register's own doors give it), so only an explicit
 * refusal turns a member away.
 */
export function refusedRegisterKey(
  permissions: Readonly<Record<string, boolean | undefined>> | null | undefined,
  kind: DeliveryRegisterGateKind,
): string | null {
  for (const key of DELIVERY_REGISTER_KEYS[kind]) {
    const held = key === REGISTER_KEY ? permissions?.[key] === true : permissions?.[key] !== false
    if (!held) return key
  }
  return null
}
