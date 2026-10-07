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

import { posMoney } from '../model/commerce-pos-ops'
import { posOpsSettings } from '../pos-ops-config'
import {
  defaultPosOpsDeps,
  posOpsCleanId,
  resolvePosStaffAssertion,
  type PosOpsDeps,
} from './pos-ops-gate'

/*==========================================
 * HOW MUCH THE REGISTER MAY REFUND (AGL-3609).
 *
 * A workspace admin refunds anything, as before. A member who works the
 * register refunds a POS sale up to the site's cashier refund limit
 * (`posRefundLimit`, $0 by default, so out of the box every register refund
 * needs a manager), and above it only with a MANAGER ASSERTION: a workspace
 * admin's PIN, entered at that register for that refund, minted for two
 * minutes and re-checked against the manager's role when it is used.
 *
 * Only a POS sale. An online order's refund stays a workspace admin's, so the
 * register's limit is not a way to refund the storefront.
 *=========================================*/

export type PosRefundAuthority =
  | { ok: true; approvedBy?: string }
  | { ok: false; body: { error: string; needsManager?: boolean; limitCents?: number } }

/** The limit question, with the money already known. */
export async function decidePosRefundAuthority(
  deps: PosOpsDeps,
  input: {
    hostId: string
    hostRef: FirebaseFirestore.DocumentReference
    registerId: string
    refundCents: number
    limitCents: number
    /** The member asking is a workspace admin, or a manager's PIN stands behind them. */
    isManager: boolean
    managerAssertion: unknown
  },
): Promise<PosRefundAuthority> {
  if (input.isManager || input.refundCents <= input.limitCents) return { ok: true }
  const registerId = posOpsCleanId(input.registerId)
  const approvedBy =
    registerId && input.managerAssertion
      ? await resolvePosStaffAssertion(deps, input.hostRef, input.managerAssertion, {
          hostId: input.hostId,
          registerId,
          purpose: 'manager',
        })
      : null
  if (approvedBy) return { ok: true, approvedBy }
  return {
    ok: false,
    body: {
      error:
        input.limitCents > 0
          ? `Refunds over ${posMoney(input.limitCents)} need a manager's PIN.`
          : "Register refunds need a manager's PIN.",
      needsManager: true,
      limitCents: input.limitCents,
    },
  }
}

/**
 * For `refund.ts`: a register member refunding from the order dialog. The
 * amount is the one the route is about to reserve — the amount asked, else
 * the named lines, else everything left.
 */
export async function posRegisterRefundAuthority(
  input: {
    hostId: string
    hostRef: FirebaseFirestore.DocumentReference
    order: {
      channel?: string
      totals?: { totalCents?: number } | null
      amountCents?: number
      refundedCents?: number
    }
    amountCents: number | null
    lineCents: number | null
    registerId: string
    managerAssertion: unknown
  },
  deps: PosOpsDeps = defaultPosOpsDeps(),
): Promise<PosRefundAuthority> {
  if (input.order.channel !== 'pos') {
    return {
      ok: false,
      body: { error: 'Refunds of online orders require an admin of the whole workspace' },
    }
  }
  const remaining = Math.max(
    0,
    Math.round(Number(input.order.totals?.totalCents ?? input.order.amountCents ?? 0)) -
      Math.round(Number(input.order.refundedCents ?? 0)),
  )
  const asked =
    input.amountCents != null && Number.isFinite(input.amountCents)
      ? Math.round(input.amountCents)
      : input.lineCents != null
        ? input.lineCents
        : remaining
  const owner = await deps.orgForHost(input.hostId)
  const settings = posOpsSettings(
    owner?.orgId ? await deps.pluginConfig(owner.orgId, input.hostId).catch(() => ({})) : {},
  )
  return decidePosRefundAuthority(deps, {
    hostId: input.hostId,
    hostRef: input.hostRef,
    registerId: input.registerId,
    refundCents: Math.min(asked, remaining),
    limitCents: settings.refundLimitCents,
    isManager: false,
    managerAssertion: input.managerAssertion,
  })
}
