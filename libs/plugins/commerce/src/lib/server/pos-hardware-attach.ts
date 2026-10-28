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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
} from '@aglyn/tenant-data-admin/server/auth-pools'
import type { OrderHardwareBuyer } from '../model/commerce-orders'
import {
  POS_HARDWARE_ORDER_ID,
  posHardwareBuyerAddress,
  posHardwareSaleRecord,
  posHardwareSaleSetOptions,
  type PosHardwareAddress,
  type PosHardwareInPersonConfig,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { posHardwareAttachmentOf } from '../model/pos-hardware-in-person'
import { hardwareOrdersRef, posHardwareInPersonOrderId, posHardwareSaleRef } from './pos-hardware'
import { recordInPersonPosHardwareSale } from './pos-hardware-in-person'
import { sendPosHardwareInvite } from './pos-hardware-notify'

/*==========================================
 * ATTACHING AN IN-PERSON SALE TO ITS BUYER (AGL-4038).
 *
 * The register user who sold a card reader says whose it is: an account and
 * the workspace (and, if they chose one, the store) it is for; an account
 * with no workspace yet; or the address of someone with no account, who is
 * then invited to sign up. The order moves to the buyer's workspace the
 * moment it has one, and is pending on the selling workspace's To attach
 * list until then.
 *
 * Every attachment is checked here, never trusted from the register: the
 * account exists, it is a member of the workspace, the store is the
 * workspace's, and an address given for "no account" really has none.
 *
 * A sale not recorded yet (the register attaches the buyer while the sale is
 * still open, or the instant it is paid) carries the buyer on the register
 * order (`hardwareBuyer`), and the recorder builds the order already
 * attached. A sale already recorded is moved: created in the buyer's
 * workspace and deleted from where it was, with its retained sale record and
 * the register order, in one transaction.
 *
 * A NEW WORKSPACE CLAIMS ITS OWNER'S SALES. When a buyer who was invited
 * signs up and creates a workspace, every pending sale naming their verified
 * address (or their account) moves into it ({@link claimPosHardwareForNewWorkspace}).
 *=========================================*/

export class PosHardwareAttachRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Who the register says the buyer is, before it is checked. */
export interface PosHardwareBuyerRequest {
  uid?: unknown
  orgId?: unknown
  hostId?: unknown
  email?: unknown
  /** The buyer's name, typed at the sale; an account's own name wins. */
  name?: unknown
  /** The buyer's business address, typed at the sale (optional). */
  address?: unknown
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/

const id = (value: unknown): string | null => (typeof value === 'string' && ID.test(value.trim()) ? value.trim() : null)

function firestore() {
  return firebaseAdmin.app().firestore()
}

/** A checked buyer: who they are, where the order goes, where its emails go. */
export interface CheckedBuyer {
  uid: string | null
  orgId: string | null
  hostId: string | null
  email: string | null
  /**
   * The buyer's name and business address, for the platform's reseller
   * records (AGL-4038): the account's name, else the one typed; the address
   * typed at the sale, when one was.
   */
  name?: string | null
  address?: PosHardwareAddress | null
}

/** The name and address the register typed, checked: an address is all of it or refused. */
function typedIdentity(request: PosHardwareBuyerRequest): { name: string | null; address: PosHardwareAddress | null } {
  const name = typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 200) : null
  if (request.address === undefined || request.address === null || request.address === '') {
    return { name, address: null }
  }
  const address = posHardwareBuyerAddress(request.address)
  if (!address) {
    throw new PosHardwareAttachRefusal('Enter the buyer’s street, city, postal code and two-letter country, or leave the address empty.', 400)
  }
  return { name, address }
}

/**
 * The buyer the register named, checked. Refuses an account that does not
 * exist or is not in the workspace, a store not in the workspace, and an
 * address said to have no account that has one.
 */
export async function checkHardwareBuyer(request: PosHardwareBuyerRequest): Promise<CheckedBuyer> {
  const uid = id(request.uid)
  const orgId = id(request.orgId)
  const hostId = id(request.hostId)
  const typed = typedIdentity(request)
  if (uid) {
    const user = await findUserByUidAcrossPools(uid)
    if (!user) throw new PosHardwareAttachRefusal('That account no longer exists. Look the buyer up again.', 404)
    const email = String(user.record.email ?? '').trim().toLowerCase() || null
    const name = String(user.record.displayName ?? '').trim().slice(0, 200) || typed.name
    if (!orgId) return { uid, orgId: null, hostId: null, email, name, address: typed.address }
    const member = await firestore().collection('orgs').doc(orgId).collection('members').doc(uid).get()
    if (!member.exists) {
      throw new PosHardwareAttachRefusal('That person is not on that workspace. Look the buyer up again.', 409)
    }
    if (hostId) {
      const host = await firestore().collection('hosts').doc(hostId).get()
      if (!host.exists || host.get('orgId') !== orgId) {
        throw new PosHardwareAttachRefusal('That store is not in the buyer’s workspace.', 409)
      }
    }
    return { uid, orgId, hostId, email, name, address: typed.address }
  }
  const email = String(request.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) throw new PosHardwareAttachRefusal('Enter the buyer’s email address.', 400)
  if (await findUserByEmailAcrossPools(email)) {
    throw new PosHardwareAttachRefusal(
      'That email already has an account. Look it up and attach the account instead.',
      409,
    )
  }
  return { uid: null, orgId: null, hostId: null, email, ...typed }
}

/** The buyer as the register order keeps it. */
function orderBuyer(buyer: CheckedBuyer, attachedBy: string | null, now: number): OrderHardwareBuyer {
  return {
    uid: buyer.uid,
    orgId: buyer.orgId,
    hostId: buyer.hostId,
    email: buyer.email,
    attachedBy: attachedBy ?? '',
    attachedAtMs: now,
    ...(buyer.name ? { name: buyer.name } : {}),
    ...(buyer.address ? { address: buyer.address } : {}),
  }
}

export type PosHardwareAttachOutcome =
  | { outcome: 'waiting'; registerOrderId: string }
  | { outcome: 'attached' | 'pending'; orderId: string; orgId: string; order: PosHardwareOrder }

/**
 * Moves (or re-stamps) a recorded order for its new buyer, in one
 * transaction with its sale record and the register order. Returns the order
 * as it now stands.
 */
async function moveRecordedOrder(input: {
  orderId: string
  buyer: CheckedBuyer
  attachedBy: string | null
  config: PosHardwareInPersonConfig
  now: number
  /** Only a pending order moves: an attached one must be detached first. */
  requirePending: boolean
}): Promise<{ order: PosHardwareOrder; orgId: string }> {
  const { orderId, buyer, attachedBy, config, now } = input
  const saleRef = posHardwareSaleRef(orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const sale = await transaction.get(saleRef)
    if (!sale.exists) throw new PosHardwareAttachRefusal('No such card reader sale.', 404)
    const fromOrgId = String(sale.get('orgId') ?? '')
    const fromRef = hardwareOrdersRef(fromOrgId).doc(orderId)
    const from = await transaction.get(fromRef)
    if (!from.exists) throw new PosHardwareAttachRefusal('No such card reader sale.', 404)
    const before = from.data() as PosHardwareOrder
    if (before.source !== 'in_person' || before.posSale?.hostId !== config.sellerHostId) {
      throw new PosHardwareAttachRefusal('Only a card reader sold in person here can be attached.', 409)
    }
    if (before.status === 'canceled' || before.status === 'refunded') {
      throw new PosHardwareAttachRefusal('This sale was refunded and can no longer be attached.', 409)
    }
    const fresh = posHardwareAttachmentOf(orderBuyer(buyer, attachedBy, now))
    // The same person again (a claim on sign-up, a store chosen later)
    // keeps the name and address already known of them.
    const samePerson = Boolean(
      (fresh.uid && before.attachment?.uid === fresh.uid) ||
        (fresh.email && before.attachment?.email === fresh.email),
    )
    const attachment = {
      ...fresh,
      name: fresh.name ?? (samePerson ? (before.attachment?.name ?? null) : null),
      address: fresh.address ?? (samePerson ? (before.attachment?.address ?? null) : null),
    }
    const same =
      before.attachment?.state === attachment.state &&
      (before.attachment?.uid ?? null) === attachment.uid &&
      (before.attachment?.orgId ?? null) === attachment.orgId &&
      (before.attachment?.email ?? null) === attachment.email &&
      (before.attachment?.hostId ?? null) === attachment.hostId &&
      (before.attachment?.name ?? null) === attachment.name &&
      JSON.stringify(before.attachment?.address ?? null) === JSON.stringify(attachment.address)
    if (same) return { order: before, orgId: fromOrgId }
    if (input.requirePending && before.attachment?.state === 'attached') {
      throw new PosHardwareAttachRefusal('This sale is already attached. Detach it first.', 409)
    }
    const toOrgId = attachment.state === 'attached' ? (attachment.orgId as string) : config.sellerOrgId
    const after: PosHardwareOrder = {
      ...before,
      orgId: toOrgId,
      hostId: attachment.state === 'attached' ? (attachment.hostId ?? '') : '',
      createdBy: attachment.uid,
      // The buyer's address for the order's emails; the receipt address a
      // pending sale carried was the register's, not necessarily theirs.
      contactEmail: attachment.email,
      attachment: {
        ...attachment,
        // An invitation already sent stays sent for the same address.
        ...(before.attachment?.email === attachment.email && before.attachment?.invitedAtMs
          ? { invitedAtMs: before.attachment.invitedAtMs }
          : {}),
      },
      updatedAtMs: now,
    }
    if (toOrgId === fromOrgId) {
      transaction.set(fromRef, after)
    } else {
      transaction.create(hardwareOrdersRef(toOrgId).doc(orderId), after)
      transaction.delete(fromRef)
    }
    transaction.set(saleRef, posHardwareSaleRecord(orderId, after), posHardwareSaleSetOptions(after))
    const registerOrderId = before.posSale?.orderId
    if (registerOrderId) {
      transaction.set(
        firestore().collection('hosts').doc(config.sellerHostId).collection('orders').doc(registerOrderId),
        { hardwareBuyer: orderBuyer(buyer, attachedBy, now) },
        { merge: true },
      )
    }
    return { order: after, orgId: toOrgId }
  })
}

/**
 * Says whose a sale's hardware is: by the register order (the sale the
 * register just rang, recorded or not) or by the hardware order's id (a sale
 * on the To attach list). Invites a buyer with no account, once.
 */
export async function attachPosHardwareSale(input: {
  config: PosHardwareInPersonConfig
  buyer: CheckedBuyer
  attachedBy: string | null
  registerOrderId?: string | null
  orderId?: string | null
  now?: number
}): Promise<PosHardwareAttachOutcome> {
  const now = input.now ?? Date.now()
  const registerOrderId = id(input.registerOrderId)
  const orderId = registerOrderId
    ? posHardwareInPersonOrderId(input.config.sellerHostId, registerOrderId)
    : String(input.orderId ?? '')
  if (!POS_HARDWARE_ORDER_ID.test(orderId)) throw new PosHardwareAttachRefusal('Name the sale to attach.', 400)

  const recorded = (await posHardwareSaleRef(orderId).get()).exists
  if (!recorded) {
    if (!registerOrderId) throw new PosHardwareAttachRefusal('No such card reader sale.', 404)
    const registerRef = firestore()
      .collection('hosts')
      .doc(input.config.sellerHostId)
      .collection('orders')
      .doc(registerOrderId)
    const register = await registerRef.get()
    if (!register.exists) throw new PosHardwareAttachRefusal('No such sale on this register.', 404)
    const status = String(register.get('status') ?? '')
    if (status !== 'pending' && status !== 'paid') {
      throw new PosHardwareAttachRefusal('This sale was voided or refunded and can no longer be attached.', 409)
    }
    await registerRef.set({ hardwareBuyer: orderBuyer(input.buyer, input.attachedBy, now) }, { merge: true })
    if (status === 'pending') return { outcome: 'waiting', registerOrderId }
    // Paid and not yet recorded: record it now, already attached.
    const outcome = await recordInPersonPosHardwareSale(input.config.sellerHostId, registerOrderId, {
      config: input.config,
      now,
    })
    if (outcome.outcome !== 'recorded' && outcome.outcome !== 'already') {
      throw new PosHardwareAttachRefusal('This sale has no card reader to attach.', 409)
    }
    if (outcome.outcome === 'recorded') return await settled(outcome.orderId, input.config)
    // Recorded by the listener between the two reads: attach the recorded one.
  }
  const moved = await moveRecordedOrder({
    orderId,
    buyer: input.buyer,
    attachedBy: input.attachedBy,
    config: input.config,
    now,
    requirePending: true,
  })
  return await settled(orderId, input.config, moved)
}

/** The order as it stands, after inviting a buyer with no account if it is owed. */
async function settled(
  orderId: string,
  config: PosHardwareInPersonConfig,
  known?: { order: PosHardwareOrder; orgId: string },
): Promise<PosHardwareAttachOutcome> {
  let current = known
  if (!current) {
    const sale = await posHardwareSaleRef(orderId).get()
    const orgId = String(sale.get('orgId') ?? config.sellerOrgId)
    const doc = await hardwareOrdersRef(orgId).doc(orderId).get()
    current = { order: doc.data() as PosHardwareOrder, orgId }
  }
  let order = await invitePendingBuyer(orderId, current.orgId, current.order)
  // The buyer's address for the reseller's records, from the store chosen
  // for the readers, where the register typed none (AGL-4038).
  if (order.attachment?.state === 'attached' && order.attachment.hostId && !order.attachment.address) {
    const { fillPosHardwareBuyerAddress } = await import('./pos-hardware-buyer-record')
    if (await fillPosHardwareBuyerAddress({ orgId: current.orgId, orderId })) {
      const fresh = await hardwareOrdersRef(current.orgId).doc(orderId).get()
      order = (fresh.data() as PosHardwareOrder | undefined) ?? order
    }
  }
  return {
    outcome: order.attachment?.state === 'attached' ? 'attached' : 'pending',
    orderId,
    orgId: current.orgId,
    order,
  }
}

/**
 * Sends the sign-up invitation to a pending buyer with an address and no
 * account, once per address: the stamp is claimed in a transaction before
 * the email goes, so two callers never both send it.
 */
export async function invitePendingBuyer(
  orderId: string,
  orgId: string,
  order: PosHardwareOrder,
): Promise<PosHardwareOrder> {
  const attachment = order.attachment
  if (!attachment || attachment.state !== 'pending' || attachment.uid || !attachment.email || attachment.invitedAtMs) {
    return order
  }
  const ref = hardwareOrdersRef(orgId).doc(orderId)
  const claimed = await firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    const now = snapshot.exists ? (snapshot.data() as PosHardwareOrder) : null
    if (!now?.attachment || now.attachment.invitedAtMs || now.attachment.email !== attachment.email) return null
    const invitedAtMs = Date.now()
    // The whole map, read in this transaction, rather than a dotted path.
    const next = { ...now.attachment, invitedAtMs }
    transaction.update(ref, { attachment: next })
    return { ...now, attachment: next } as PosHardwareOrder
  })
  if (!claimed) return order
  await sendPosHardwareInvite(orderId, claimed)
  return claimed
}

/**
 * Puts an attached sale back on the To attach list: the wrong buyer was
 * chosen. Refused once one of its readers is set up on the buyer's store.
 */
export async function detachPosHardwareSale(input: {
  config: PosHardwareInPersonConfig
  orderId: string
  now?: number
}): Promise<{ order: PosHardwareOrder }> {
  const { config, orderId } = input
  if (!POS_HARDWARE_ORDER_ID.test(orderId)) throw new PosHardwareAttachRefusal('Name the sale to detach.', 400)
  const now = input.now ?? Date.now()
  const saleRef = posHardwareSaleRef(orderId)
  return firestore().runTransaction(async (transaction: any) => {
    const sale = await transaction.get(saleRef)
    if (!sale.exists) throw new PosHardwareAttachRefusal('No such card reader sale.', 404)
    const fromOrgId = String(sale.get('orgId') ?? '')
    const fromRef = hardwareOrdersRef(fromOrgId).doc(orderId)
    const from = await transaction.get(fromRef)
    if (!from.exists) throw new PosHardwareAttachRefusal('No such card reader sale.', 404)
    const before = from.data() as PosHardwareOrder
    if (before.source !== 'in_person' || before.posSale?.hostId !== config.sellerHostId) {
      throw new PosHardwareAttachRefusal('Only a card reader sold in person here can be detached.', 409)
    }
    if (before.attachment?.state !== 'attached') return { order: before }
    if ((before.units ?? []).some((unit) => unit.readerId)) {
      throw new PosHardwareAttachRefusal('A reader from this sale is already set up on the buyer’s store.', 409)
    }
    const after: PosHardwareOrder = {
      ...before,
      orgId: config.sellerOrgId,
      hostId: '',
      createdBy: null,
      contactEmail: null,
      attachment: posHardwareAttachmentOf(null),
      updatedAtMs: now,
    }
    transaction.create(hardwareOrdersRef(config.sellerOrgId).doc(orderId), after)
    transaction.delete(fromRef)
    transaction.set(saleRef, posHardwareSaleRecord(orderId, after), posHardwareSaleSetOptions(after))
    const registerOrderId = before.posSale?.orderId
    if (registerOrderId) {
      transaction.set(
        firestore().collection('hosts').doc(config.sellerHostId).collection('orders').doc(registerOrderId),
        { hardwareBuyer: firebaseAdmin.firestore.FieldValue.delete() },
        { merge: true },
      )
    }
    return { order: after }
  })
}

/**
 * A workspace was just created: every pending sale naming its owner — their
 * account, or their address once verified — moves into it. Never throws:
 * a sale it cannot move stays on the To attach list.
 */
export async function claimPosHardwareForNewWorkspace(input: {
  config: PosHardwareInPersonConfig | null
  orgId: string
  ownerUid: string
  ownerEmail: string | null
  emailVerified: boolean
}): Promise<{ claimed: number }> {
  const { config } = input
  if (!config || !id(input.orgId) || !id(input.ownerUid)) return { claimed: 0 }
  const pending = hardwareOrdersRef(config.sellerOrgId)
  const email = input.emailVerified ? String(input.ownerEmail ?? '').trim().toLowerCase() : ''
  const [byUid, byEmail] = await Promise.all([
    pending.where('attachment.uid', '==', input.ownerUid).limit(20).get(),
    email ? pending.where('attachment.email', '==', email).limit(20).get() : Promise.resolve({ docs: [] }),
  ])
  const ids = new Set<string>()
  for (const doc of [...byUid.docs, ...byEmail.docs] as Array<{ id: string; data: () => PosHardwareOrder }>) {
    if (doc.data().attachment?.state === 'pending') ids.add(String(doc.id))
  }
  let claimed = 0
  // Their account's name, for the reseller's records of the sale.
  const owner = ids.size ? await findUserByUidAcrossPools(input.ownerUid).catch(() => null) : null
  const name = String(owner?.record.displayName ?? '').trim().slice(0, 200) || null
  for (const orderId of ids) {
    try {
      await moveRecordedOrder({
        orderId,
        buyer: {
          uid: input.ownerUid,
          orgId: input.orgId,
          hostId: null,
          // Their account's address carries the order's emails from now on.
          email: String(input.ownerEmail ?? '').trim().toLowerCase() || null,
          name,
        },
        attachedBy: null,
        config,
        now: Date.now(),
        requirePending: true,
      })
      claimed += 1
    } catch (error) {
      console.error('[pos-hardware-attach] a pending sale was not claimed', orderId, error)
    }
  }
  return { claimed }
}
