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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  normalizePosHardwareSerial,
  POS_HARDWARE_ORDER_ID,
  POS_HARDWARE_ORDERS_COLLECTION,
  posHardwareSaleRecord,
  posHardwareSku,
  type PosHardwareInPersonConfig,
  type PosHardwareOrder,
  type PosHardwareUnit,
} from '../model/pos-hardware'
import { posHardwareAttachmentOf } from '../model/pos-hardware-in-person'
import { hardwareOrdersRef, posHardwareInPersonOrderId, posHardwareSaleRef } from './pos-hardware'

/*==========================================
 * A CARD READER SOLD IN PERSON, ONTO THE BUYER'S STORE (AGL-4038).
 *
 * Three ways, and every one ends with the order at Set up:
 *
 *   1. The serial number taken at the sale. Staff scan or type each reader's
 *      serial on the sale; when the buyer registers a reader with that
 *      serial (by its code, on the POS devices card), the reader is matched
 *      to its unit here and the order moves to Set up once every reader on
 *      it is — no step for the buyer. A sale nobody had attached yet is
 *      attached to the workspace that registered its reader: only whoever
 *      holds the reader can show its code.
 *   2. Registered at the booth. A register user registers the reader to the
 *      store the buyer chose, by its code, while the buyer stands there:
 *      the store's plan must include the point of sale and the store must
 *      have a reader Location (its address), as for any registration.
 *   3. Paired later with no serial. The buyer registers it by code (or pairs
 *      an M2 by Bluetooth, which no server sees) and says "Mark set up" on
 *      the Hardware card; staff can mark it too.
 *=========================================*/

export class PosHardwareReaderRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function firestore() {
  return firebaseAdmin.app().firestore()
}

/** Whether every reader on the order is registered: then it is Set up. */
function everyReaderRegistered(units: readonly PosHardwareUnit[]): boolean {
  return units.length > 0 && units.every((unit) => Boolean(unit.readerId))
}

/** The order's units with `serial` registered as `readerId` on `hostId`, or null when no unit has it. */
function withRegisteredUnit(
  units: readonly PosHardwareUnit[],
  serial: string,
  readerId: string,
  hostId: string,
  now: number,
): PosHardwareUnit[] | null {
  const at = units.findIndex((unit) => unit.serialNumber === serial)
  if (at < 0) return null
  if (units[at].readerId === readerId) return [...units]
  return units.map((unit, index) =>
    index === at ? { ...unit, readerId, hostId, registeredAtMs: now } : unit,
  )
}

/**
 * A reader was just registered to a store: the in-person order that sold it
 * by this serial moves on. Attached to this workspace, or pending (then
 * attached to it now); an order attached to another workspace is left as it
 * is. Returns the orders it changed.
 */
export async function matchRegisteredPosHardwareReader(input: {
  hostId: string
  orgId: string
  uid: string
  readerId: string
  serialNumber: string
  now?: number
}): Promise<{ matched: string[] }> {
  const serial = normalizePosHardwareSerial(input.serialNumber)
  if (!serial || !input.orgId) return { matched: [] }
  const found = await firestore()
    .collectionGroup(POS_HARDWARE_ORDERS_COLLECTION)
    .where('serialNumbers', 'array-contains', serial)
    .limit(5)
    .get()
  const matched: string[] = []
  for (const doc of found.docs as unknown as Array<{ id: string; data: () => PosHardwareOrder }>) {
    const orderId = String(doc.id)
    const now = input.now ?? Date.now()
    const changed = await firestore().runTransaction(async (transaction: any) => {
      const saleRef = posHardwareSaleRef(orderId)
      const sale = await transaction.get(saleRef)
      const fromOrgId = String(sale.get('orgId') ?? doc.data().orgId ?? '')
      const fromRef = hardwareOrdersRef(fromOrgId).doc(orderId)
      const from = await transaction.get(fromRef)
      if (!from.exists) return false
      const before = from.data() as PosHardwareOrder
      if (before.source !== 'in_person' || before.status === 'canceled' || before.status === 'refunded') return false
      const pending = before.attachment?.state !== 'attached'
      if (!pending && fromOrgId !== input.orgId) return false
      const units = withRegisteredUnit(before.units ?? [], serial, input.readerId, input.hostId, now)
      if (!units) return false
      const done = everyReaderRegistered(units)
      const after: PosHardwareOrder = {
        ...before,
        ...(pending
          ? {
              orgId: input.orgId,
              hostId: input.hostId,
              createdBy: input.uid,
              attachment: {
                ...posHardwareAttachmentOf({
                  uid: input.uid,
                  orgId: input.orgId,
                  hostId: input.hostId,
                  email: before.attachment?.email ?? null,
                  attachedBy: '',
                  attachedAtMs: now,
                }),
              },
            }
          : { hostId: before.hostId || input.hostId }),
        units,
        ...(done && before.status === 'delivered' ? { status: 'registered' as const, registeredAtMs: now } : {}),
        updatedAtMs: now,
      }
      if (after.orgId === fromOrgId) {
        transaction.set(fromRef, after)
      } else {
        transaction.create(hardwareOrdersRef(after.orgId).doc(orderId), after)
        transaction.delete(fromRef)
      }
      transaction.set(saleRef, posHardwareSaleRecord(orderId, after))
      return true
    })
    if (changed) matched.push(orderId)
  }
  return { matched }
}

/**
 * The serial numbers of a sale's readers, taken at the sale: on the hardware
 * order once it is recorded, or on the register sale until it is (the
 * recorder takes them from there). Each is normalized, none may repeat, and
 * none may already be on another sale.
 */
export async function recordPosHardwareSerials(input: {
  config: PosHardwareInPersonConfig
  registerOrderId?: string | null
  orderId?: string | null
  serials: unknown
}): Promise<{ orderId: string; serials: string[]; recorded: boolean }> {
  const serials = (Array.isArray(input.serials) ? input.serials : [])
    .map(normalizePosHardwareSerial)
    .filter(Boolean)
  if (new Set(serials).size !== serials.length) {
    throw new PosHardwareReaderRefusal('A serial number is listed twice.', 400)
  }
  const registerOrderId = String(input.registerOrderId ?? '')
  const orderId = registerOrderId
    ? posHardwareInPersonOrderId(input.config.sellerHostId, registerOrderId)
    : String(input.orderId ?? '')
  if (!POS_HARDWARE_ORDER_ID.test(orderId)) throw new PosHardwareReaderRefusal('Name the sale.', 400)
  for (const serial of serials) {
    const elsewhere = await firestore()
      .collectionGroup(POS_HARDWARE_ORDERS_COLLECTION)
      .where('serialNumbers', 'array-contains', serial)
      .limit(2)
      .get()
    if (elsewhere.docs.some((doc: any) => String(doc.id) !== orderId)) {
      throw new PosHardwareReaderRefusal(`Serial number ${serial} is already on another sale.`, 409)
    }
  }
  const saleRef = posHardwareSaleRef(orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const sale = await transaction.get(saleRef)
    if (!sale.exists) {
      if (!registerOrderId) throw new PosHardwareReaderRefusal('No such card reader sale.', 404)
      const registerRef = firestore()
        .collection('hosts')
        .doc(input.config.sellerHostId)
        .collection('orders')
        .doc(registerOrderId)
      const register = await transaction.get(registerRef)
      const status = String(register.get('status') ?? '')
      if (!register.exists || (status !== 'pending' && status !== 'paid')) {
        throw new PosHardwareReaderRefusal('No open or paid sale on this register by that number.', 404)
      }
      transaction.set(registerRef, { hardwareSerials: serials }, { merge: true })
      return { orderId, serials, recorded: false }
    }
    const ref = hardwareOrdersRef(String(sale.get('orgId') ?? '')).doc(orderId)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new PosHardwareReaderRefusal('No such card reader sale.', 404)
    const before = snapshot.data() as PosHardwareOrder
    if (before.source !== 'in_person' || before.posSale?.hostId !== input.config.sellerHostId) {
      throw new PosHardwareReaderRefusal('Only a card reader sold in person here takes serial numbers.', 409)
    }
    const units = before.units ?? []
    if (serials.length > units.length) {
      throw new PosHardwareReaderRefusal(`This sale has ${units.length} reader${units.length === 1 ? '' : 's'}.`, 400)
    }
    // Serials fill the readers not yet set up, in order; a registered one keeps its own.
    const open = units.map((unit, index) => ({ unit, index })).filter(({ unit }) => !unit.readerId)
    const next = [...units]
    open.forEach(({ index }, position) => {
      next[index] = { ...units[index], serialNumber: serials[position] ?? null }
    })
    transaction.update(ref, {
      units: next,
      serialNumbers: next.flatMap((unit) => (unit.serialNumber ? [unit.serialNumber] : [])),
      updatedAtMs: Date.now(),
    })
    return { orderId, serials, recorded: true }
  })
}

/** An in-person order of this workspace, for a change by its own people. */
function workspaceOrder(orgId: string, orderId: string) {
  if (!POS_HARDWARE_ORDER_ID.test(orderId)) throw new PosHardwareReaderRefusal('No such order.', 404)
  return { ref: hardwareOrdersRef(orgId).doc(orderId) }
}

/**
 * The store a reader bought in person is for, chosen at setup by someone
 * who may set up devices there. The store must be the workspace's.
 */
export async function choosePosHardwareStore(input: {
  orgId: string
  orderId: string
  hostId: string
}): Promise<PosHardwareOrder> {
  const { ref } = workspaceOrder(input.orgId, input.orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new PosHardwareReaderRefusal('No such order.', 404)
    const before = snapshot.data() as PosHardwareOrder
    if (before.source !== 'in_person') throw new PosHardwareReaderRefusal('Only a reader bought in person waits for a store.', 409)
    const after: PosHardwareOrder = {
      ...before,
      hostId: input.hostId,
      ...(before.attachment ? { attachment: { ...before.attachment, hostId: input.hostId } } : {}),
      updatedAtMs: Date.now(),
    }
    transaction.set(ref, after)
    transaction.set(posHardwareSaleRef(input.orderId), posHardwareSaleRecord(input.orderId, after))
    return after
  })
}

/**
 * "Mark set up": a reader bought in person was paired by its code or by
 * Bluetooth with no serial taken at the sale, so nothing matched it. The
 * workspace says so, and the order moves to Set up.
 */
export async function markPosHardwareSetUp(input: { orgId: string; orderId: string }): Promise<PosHardwareOrder> {
  const { ref } = workspaceOrder(input.orgId, input.orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new PosHardwareReaderRefusal('No such order.', 404)
    const before = snapshot.data() as PosHardwareOrder
    if (before.source !== 'in_person') throw new PosHardwareReaderRefusal('Only a reader bought in person is marked set up here.', 409)
    if (before.status === 'registered') return before
    if (before.status !== 'delivered') throw new PosHardwareReaderRefusal('This order can no longer be set up.', 409)
    const now = Date.now()
    const after: PosHardwareOrder = { ...before, status: 'registered', registeredAtMs: now, updatedAtMs: now }
    transaction.set(ref, after)
    transaction.set(posHardwareSaleRef(input.orderId), posHardwareSaleRecord(input.orderId, after))
    return after
  })
}

/** A store's readiness for a reader: its plan and its Location. */
export async function posHardwareStoreReadiness(hostId: string): Promise<{ posPlan: boolean; hasLocation: boolean }> {
  const [owner, config] = await Promise.all([
    getOrgForHost(hostId).catch(() => null),
    firestore().collection('hosts').doc(hostId).collection('terminal').doc('config').get(),
  ])
  return {
    posPlan: Aglyn.checkEntitlement(owner?.org as never, 'pos'),
    hasLocation: Boolean(config.exists && config.get('stripeLocationId')),
  }
}

/**
 * Registers a reader sold at the booth to the buyer's chosen store, by the
 * code it shows, while the buyer is there (AGL-4038). The sale must be
 * attached to them with a store chosen; the store's plan must include the
 * point of sale; the store must already have its reader Location, since
 * the booth does not take the buyer's street address.
 */
export async function registerPosHardwareAtBooth(input: {
  config: PosHardwareInPersonConfig
  orderId: string
  registrationCode: unknown
  label?: unknown
  uid: string
}): Promise<{ order: PosHardwareOrder; readerId: string }> {
  if (!POS_HARDWARE_ORDER_ID.test(input.orderId)) throw new PosHardwareReaderRefusal('Name the sale.', 400)
  const sale = await posHardwareSaleRef(input.orderId).get()
  if (!sale.exists) {
    throw new PosHardwareReaderRefusal('Take payment for the sale first, then register its reader.', 409)
  }
  const orgId = String(sale.get('orgId') ?? '')
  const snapshot = await hardwareOrdersRef(orgId).doc(input.orderId).get()
  const order = snapshot.data() as PosHardwareOrder | undefined
  if (!order || order.source !== 'in_person' || order.posSale?.hostId !== input.config.sellerHostId) {
    throw new PosHardwareReaderRefusal('No such card reader sale.', 404)
  }
  if (order.attachment?.state !== 'attached' || !order.attachment.orgId) {
    throw new PosHardwareReaderRefusal('Attach the sale to the buyer first.', 409)
  }
  const hostId = order.hostId
  if (!hostId) throw new PosHardwareReaderRefusal('Choose the buyer’s store first.', 409)
  const readiness = await posHardwareStoreReadiness(hostId)
  if (!readiness.posPlan) {
    throw new PosHardwareReaderRefusal(
      'Their workspace needs a plan with the point of sale before a reader can be added. They can add it, then set the reader up themselves.',
      409,
    )
  }
  if (!readiness.hasLocation) {
    throw new PosHardwareReaderRefusal(
      'Their store has no address for card readers yet. They add it when they set the reader up on the POS devices card.',
      409,
    )
  }
  const { registerPosTerminalReader } = await import('./pos-readers')
  const registered = await registerPosTerminalReader({
    hostId,
    orgId,
    uid: input.uid,
    registrationCode: input.registrationCode,
    label: input.label,
  })
  if ('error' in registered) throw new PosHardwareReaderRefusal(registered.error, registered.status)
  // A reader with a serial matched its unit as it registered. One without
  // (or not on the sale) takes the first reader of the sale not set up yet.
  const ref = hardwareOrdersRef(orgId).doc(input.orderId)
  const after = await firestore().runTransaction(async (transaction: any) => {
    const now = (await transaction.get(ref)).data() as PosHardwareOrder
    const units = now.units ?? []
    if (units.some((unit) => unit.readerId === registered.id)) return now
    const at = units.findIndex(
      (unit) => !unit.readerId && posHardwareSku(unit.sku)?.kind === 'reader',
    )
    if (at < 0) return now
    const stamp = Date.now()
    const next = units.map((unit, index) =>
      index === at
        ? {
            ...unit,
            serialNumber: unit.serialNumber ?? (registered.reader.serialNumber ? normalizePosHardwareSerial(registered.reader.serialNumber) : null),
            readerId: registered.id,
            hostId,
            registeredAtMs: stamp,
          }
        : unit,
    )
    const done = everyReaderRegistered(next)
    const updated: PosHardwareOrder = {
      ...now,
      units: next,
      serialNumbers: next.flatMap((unit) => (unit.serialNumber ? [unit.serialNumber] : [])),
      ...(done && now.status === 'delivered' ? { status: 'registered' as const, registeredAtMs: stamp } : {}),
      updatedAtMs: stamp,
    }
    transaction.set(ref, updated)
    transaction.set(posHardwareSaleRef(input.orderId), posHardwareSaleRecord(input.orderId, updated))
    return updated
  })
  return { order: after, readerId: registered.id }
}
