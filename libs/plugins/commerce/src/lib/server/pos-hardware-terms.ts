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

import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PosHardwareInPersonConfig, PosHardwareOrder } from '../model/pos-hardware'
import {
  isPosHardwareRegisterSale,
  posHardwareTermsAcceptance,
  posHardwareTermsAcceptanceOf,
  posHardwareTermsUrl,
  POS_HARDWARE_TERMS_SECTIONS,
  POS_HARDWARE_TERMS_SUMMARY,
  POS_HARDWARE_TERMS_VERSION,
  type PosHardwareTermsAcceptance,
} from '../model/pos-hardware-terms'
import { hardwareOrdersRef, posHardwareSaleRef } from './pos-hardware'

/*==========================================
 * ACCEPTING THE TERMS OF SALE AT THE BOOTH (AGL-4038).
 *
 * The register user hands the buyer the register tablet, or puts the terms
 * on the register's customer display through core's display seam, and the
 * buyer accepts there before paying (Terms 4.28). Either way the acceptance
 * is written here, on the register sale (`hardwareTermsAcceptance`) and, once
 * the sale has become a hardware order, on that too (`termsAcceptance`),
 * with the version, the time, how, the register user, and the device's
 * address and browser. The first acceptance stands: accepting again changes
 * nothing, and an electronic acceptance replaces only the receipt-and-sign
 * notice a sale paid without one was recorded under.
 *=========================================*/

export class PosHardwareTermsRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/

function firestore() {
  return firebaseAdmin.app().firestore()
}

function registerOrderRef(config: PosHardwareInPersonConfig, registerOrderId: string) {
  if (!ID.test(registerOrderId)) throw new PosHardwareTermsRefusal('Name the sale.', 400)
  return firestore().collection('hosts').doc(config.sellerHostId).collection('orders').doc(registerOrderId)
}

/** What the buyer reads: the version, the sections, the link and the summary. */
export function posHardwareTermsView() {
  return {
    version: POS_HARDWARE_TERMS_VERSION,
    sections: POS_HARDWARE_TERMS_SECTIONS,
    url: posHardwareTermsUrl(),
    summary: [...POS_HARDWARE_TERMS_SUMMARY],
  }
}

/** The device a request came from, as an acceptance records it. */
export function posHardwareTermsDevice(headers: Record<string, unknown>): { ip: string | null; userAgent: string | null } {
  return {
    ip: readClientIp(headers as never) ?? null,
    userAgent: String(headers['user-agent'] ?? '').slice(0, 400) || null,
  }
}

/** The sale's items and total, for the screen the buyer accepts on. */
export async function posHardwareTermsSale(
  config: PosHardwareInPersonConfig,
  registerOrderId: string,
): Promise<{ items: string[]; acceptance: PosHardwareTermsAcceptance | null }> {
  const snapshot = await registerOrderRef(config, registerOrderId).get()
  const order = snapshot.exists ? (snapshot.data() as Record<string, any>) : null
  if (!order || !isPosHardwareRegisterSale(order)) throw new PosHardwareTermsRefusal('This sale has no card reader.', 404)
  const items = (Array.isArray(order['lineItems']) ? order['lineItems'] : [])
    .slice(0, 50)
    .map((line: Record<string, unknown>) => `${Number(line['quantity'] ?? 1) || 1} × ${String(line['name'] ?? 'Item')}`)
  return { items, acceptance: posHardwareTermsAcceptanceOf(order['hardwareTermsAcceptance']) }
}

/** Whether the buyer has accepted, for the register waiting on the display. */
export async function posHardwareTermsStatus(
  config: PosHardwareInPersonConfig,
  registerOrderId: string,
): Promise<{ acceptance: PosHardwareTermsAcceptance | null }> {
  const { acceptance } = await posHardwareTermsSale(config, registerOrderId)
  return { acceptance }
}

/** Notes who put the terms on the display, so the display's acceptance names them. */
export async function requestPosHardwareTermsOnDisplay(input: {
  config: PosHardwareInPersonConfig
  registerOrderId: string
  uid: string
  now?: number
}): Promise<void> {
  const ref = registerOrderRef(input.config, input.registerOrderId)
  const snapshot = await ref.get()
  if (!snapshot.exists || !isPosHardwareRegisterSale(snapshot.data())) {
    throw new PosHardwareTermsRefusal('This sale has no card reader.', 404)
  }
  await ref.set({ hardwareTermsRequest: { by: input.uid, atMs: input.now ?? Date.now() } }, { merge: true })
}

/**
 * Records the buyer's acceptance on the register sale and on its hardware
 * order when there is one, in one transaction. The first electronic
 * acceptance stands; answers the acceptance that holds.
 */
export async function recordPosHardwareTermsAcceptance(input: {
  config: PosHardwareInPersonConfig
  registerOrderId: string
  method: 'tablet' | 'display'
  staffUid: string | null
  ip: string | null
  userAgent: string | null
  now?: number
}): Promise<PosHardwareTermsAcceptance> {
  const ref = registerOrderRef(input.config, input.registerOrderId)
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    const order = snapshot.exists ? (snapshot.data() as Record<string, any>) : null
    if (!order || !isPosHardwareRegisterSale(order)) throw new PosHardwareTermsRefusal('This sale has no card reader.', 404)
    const status = String(order['status'] ?? '')
    if (status !== 'pending' && status !== 'paid') {
      throw new PosHardwareTermsRefusal('This sale was voided or refunded.', 409)
    }
    const held = posHardwareTermsAcceptanceOf(order['hardwareTermsAcceptance'])
    if (held && held.method !== 'notice') return held
    const staffUid =
      input.method === 'display'
        ? (String(order['hardwareTermsRequest']?.['by'] ?? '') || input.staffUid)
        : input.staffUid
    const acceptance = posHardwareTermsAcceptance({
      method: input.method,
      atMs: input.now ?? Date.now(),
      staffUid,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    // The hardware order the sale already became, if it did: its notice is
    // replaced by the acceptance.
    const hardwareOrderId = typeof order['hardwareOrderId'] === 'string' ? order['hardwareOrderId'] : ''
    let hardwareRef: any = null
    if (hardwareOrderId) {
      const sale = await transaction.get(posHardwareSaleRef(hardwareOrderId))
      const orgId = String(sale.get('orgId') ?? '')
      if (orgId) {
        const candidate = hardwareOrdersRef(orgId).doc(hardwareOrderId)
        const hardware = await transaction.get(candidate)
        const current = hardware.exists ? (hardware.data() as PosHardwareOrder) : null
        const kept = posHardwareTermsAcceptanceOf(current?.termsAcceptance)
        if (current && (!kept || kept.method === 'notice')) hardwareRef = candidate
      }
    }
    transaction.set(ref, { hardwareTermsAcceptance: acceptance }, { merge: true })
    if (hardwareRef) transaction.set(hardwareRef, { termsAcceptance: acceptance, updatedAtMs: acceptance.atMs }, { merge: true })
    return acceptance
  })
}
