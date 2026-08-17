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

import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/**
 * The AGL-281 low-stock crossing alert, extracted so every stock decrement
 * fires it (AGL-1826). It used to live inline on the buy-now branch only, so
 * whether a merchant was told they were running out depended on which door the
 * sale came through: the single-product storefront button alerted, while the
 * cart, a merchant-sent draft link and the register crossed the same threshold
 * silently.
 *
 * SEMANTICS ARE THE BUY-NOW BRANCH'S, UNCHANGED:
 *
 * - The threshold is the product's own `lowStockThreshold`, compared against
 *   the flat total across TRACKED variants (`isLowStock` /
 *   `productInventory`). No threshold configured means no alert, ever.
 * - It fires on the CROSSING adjustment only — low after, not low before — so
 *   managers get one nudge per threshold breach, not one per order after it.
 * - Redelivery safety is the CALLER's replay guard, not re-checked here:
 *   every call site sits behind its branch's own gate (the cart and buy-now
 *   `created` transactions, the draft branch's pending-to-paid flip, the
 *   POS handler's `claimAttempt`), so a redelivered event never recomputes the
 *   pair this compares.
 *
 * Takes the PRE- and POST-decrement product states the caller just computed —
 * never a re-read, which could see its own write (no crossing observed) or a
 * concurrent one (somebody else's crossing attributed here). Callers looping
 * over lines must hand in the compounded pair (AGL-1828/AGL-1825): each line's
 * `lifted` is the previous line's `updated`, so two lines of one product cross
 * exactly once, on the line that actually breaches.
 *
 * Fire-and-forget like the sibling notifications on every branch —
 * `notifyHostManagers` never throws, and an alert must never fail a webhook.
 */
export function alertLowStockCrossing(
  hostId: string,
  lifted: Pick<
    CommerceModel.HostProduct,
    'name' | 'variants' | 'lowStockThreshold'
  >,
  updated: Pick<
    CommerceModel.HostProduct,
    'name' | 'variants' | 'lowStockThreshold'
  >,
): void {
  if (
    CommerceModel.isLowStock(updated) &&
    !CommerceModel.isLowStock(lifted)
  ) {
    void notifyHostManagers(hostId, {
      type: 'content.lowStock',
      title: `Low stock — ${updated.name}`,
      body: `${CommerceModel.productInventory(updated) ?? 0} left across tracked variants`,
      link: `/${hostId}/products`,
    })
  }
}
