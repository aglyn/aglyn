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

import { posOpsSettings } from '../pos-ops-config'
import { defaultPosOpsDeps, posOpsCleanId, resolvePosCashier, type PosOpsDeps } from './pos-ops-gate'

/*==========================================
 * WHAT EVERY REGISTER SALE CARRIES (AGL-3609), stamped where the sale is
 * written:
 *
 *   cashierId       the member a PIN switched in, re-checked against their
 *                   role now, or the member signed in on the device
 *   shiftId         the register's open shift, so the X and Z reports count
 *                   the sale — and a refusal when the site requires a shift
 *                   and none is open
 *   customerRecord  the person the cashier attached from the lookup, with
 *                   the name the receipt and the order show. Never their
 *                   phone: `customerPhone` is the number a buyer gave for
 *                   order texts, and a lookup is not that
 *=========================================*/

export interface PosSaleStampInput {
  hostId: string
  hostRef: FirebaseFirestore.DocumentReference
  registerId: string
  /** The register's `openShiftId`, from the read the sale already made. */
  openShiftId: unknown
  /** Who the sale route's own gate admitted. */
  signedInUid: string
  /** The sale request's body. */
  body: Record<string, any>
  /** The site's merged commerce config. */
  config: Record<string, unknown> | null | undefined
  deps?: PosOpsDeps
}

export interface PosSaleStamp {
  cashierId: string
  /** The fields the order document takes, besides `cashierId`. */
  fields: {
    shiftId?: string
    customerName?: string
    customerRecord?: { kind: string; id: string }
  }
}

export type PosSaleStampOutcome =
  | { ok: true; stamp: PosSaleStamp }
  | { ok: false; status: number; error: string }

const bounded = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** The attached customer, bounded; nothing when the register sent none. */
export function posSaleCustomerFields(raw: unknown): PosSaleStamp['fields'] {
  if (!raw || typeof raw !== 'object') return {}
  const customer = raw as Record<string, unknown>
  const name = bounded(customer['name'], 200)
  const kind = bounded(customer['kind'], 40)
  const id = posOpsCleanId(customer['id'])
  return {
    ...(name ? { customerName: name } : {}),
    ...(kind && kind !== 'none' && id ? { customerRecord: { kind, id } } : {}),
  }
}

export async function posSaleStamp(input: PosSaleStampInput): Promise<PosSaleStampOutcome> {
  const shiftId = posOpsCleanId(input.openShiftId)
  if (!shiftId && posOpsSettings(input.config).requireOpenShift) {
    return { ok: false, status: 409, error: 'Open a shift on this register before ringing a sale.' }
  }
  const assertion = input.body['cashierAssertion']
  const cashier = assertion
    ? await resolvePosCashier(
        input.deps ?? defaultPosOpsDeps(),
        { uid: input.signedInUid, hostId: input.hostId, hostRef: input.hostRef },
        input.registerId,
        assertion,
      )
    : { cashierId: input.signedInUid }
  return {
    ok: true,
    stamp: {
      cashierId: cashier.cashierId,
      fields: {
        ...(shiftId ? { shiftId } : {}),
        ...posSaleCustomerFields(input.body['customer']),
      },
    },
  }
}

/**
 * Who takes a payment toward an open sale: the member a cashier assertion
 * names, checked against the SALE's register (an assertion minted at one
 * till does not ring at another), or the member signed in on the device.
 */
export async function posPaymentCashierId(input: {
  hostId: string
  orderId: string
  signedInUid: string
  assertion: unknown
  deps?: PosOpsDeps
}): Promise<string> {
  const orderId = posOpsCleanId(input.orderId)
  if (!input.assertion || !orderId) return input.signedInUid
  const deps = input.deps ?? defaultPosOpsDeps()
  const hostRef = deps.firestore().collection('hosts').doc(input.hostId)
  const order = await hostRef.collection('orders').doc(orderId).get()
  const registerId = posOpsCleanId(order.get('registerId'))
  if (!registerId) return input.signedInUid
  const { cashierId } = await resolvePosCashier(
    deps,
    { uid: input.signedInUid, hostId: input.hostId, hostRef },
    registerId,
    input.assertion,
  )
  return cashierId
}
