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

import type { PluginApiRequest } from '@aglyn/aglyn/server'

/*==========================================
 * A SELF-SERVICE KIOSK'S SALE, AS THE SALE ROUTE SEES IT (AGL-3623).
 *
 * The kiosk route (`pos-kiosk.ts`) prices a customer's cart by calling the
 * register's own sale route in-process, so a kiosk order is priced, taxed,
 * discounted and fee'd by exactly the code every register sale is. It holds
 * no Firebase session, so it hands the sale route this principal instead of
 * an ID token: the staff member whose pairing code opened the kiosk, whose
 * role, `managePos` and plan the sale route re-checks as it would theirs.
 *
 * The principal rides on a module-private Symbol. Nothing that arrives over
 * HTTP — a header, a query, a JSON body — can carry one, so only code in
 * this process that imports this module can make a request a kiosk's.
 *=========================================*/

const PRINCIPAL = Symbol('aglyn.commerce.posKioskPrincipal')

export interface PosKioskPrincipal {
  /** The staff member who paired the kiosk; re-checked by the sale route. */
  uid: string
  /** The one register the kiosk was paired to. */
  registerId: string
  /** The kiosk's token hash prefix, for the order's record. */
  deviceId: string
}

/** A request the sale route reads as the kiosk's. */
export function withPosKioskPrincipal<T extends PluginApiRequest>(
  req: T,
  principal: PosKioskPrincipal,
): T {
  Object.defineProperty(req, PRINCIPAL, { value: principal, enumerable: false })
  return req
}

/** The kiosk a request was made for in-process, or null. */
export function posKioskPrincipal(req: PluginApiRequest): PosKioskPrincipal | null {
  const value = (req as unknown as Record<symbol, unknown>)[PRINCIPAL] as PosKioskPrincipal | undefined
  return value && typeof value.uid === 'string' && value.uid ? value : null
}
