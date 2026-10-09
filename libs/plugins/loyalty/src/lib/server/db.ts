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

import { createHash, randomBytes } from 'crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { Firestore } from 'firebase-admin/firestore'
import { LOYALTY_COLLECTIONS } from '../constants/bundle-common'
import { formatLoyaltyCode, loyaltyCodeBytes, type LoyaltyCodeKind } from '../model/loyalty-math'

/**
 * The Firestore every loyalty server module writes through, the keys its
 * documents are named by, and the codes it mints (AGL-3640). One getter, so
 * a spec swaps one thing.
 */

let override: unknown = null
let bytesOverride: ((size: number) => Uint8Array) | null = null

export function loyaltyDb(): Firestore {
  return (override ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam. */
export function setLoyaltyDbForTests(db: unknown): void {
  override = db
}

/** Test seam: the random bytes codes are drawn from. */
export function setLoyaltyRandomBytesForTests(source: ((size: number) => Uint8Array) | null): void {
  bytesOverride = source
}

/** Whether a client-supplied id is one Firestore will take as a document id. */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

/** How a member is named without their address: a hash of it, per site. */
export function memberKeyFor(hostId: string, email: string): string {
  return createHash('sha256').update(`${hostId}\u0000${email}`).digest('hex').slice(0, 32)
}

/** A short, path-safe id for anything a caller names with a free-form key. */
export function keyId(key: string): string {
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 24)
}

/** A fresh code of `kind`. */
export function mintLoyaltyCode(kind: LoyaltyCodeKind): string {
  const size = loyaltyCodeBytes(kind)
  return formatLoyaltyCode(kind, bytesOverride ? bytesOverride(size) : randomBytes(size))
}

function collection(orgId: string, name: string) {
  return loyaltyDb().collection('orgs').doc(orgId).collection(name)
}

/**
 * The document ids, one scheme each. Every one is DERIVED on purpose: a member
 * is one document per site and customer, a code resolves straight to its row,
 * and a ledger entry, a redemption or a referral claim is keyed by what caused
 * it, so a retried webhook or a double-submitted register sale lands on the
 * row it already wrote instead of crediting twice.
 */
export const loyaltyDocIds = {
  member: (hostId: string, memberKey: string): string => `${hostId}__${memberKey}`,
  code: (hostId: string, code: string): string => `${hostId}__${code}`,
  ledger: (hostId: string, entryKey: string): string => `${hostId}__${entryKey}`,
  redemption: (hostId: string, orderId: string, memberKey: string): string =>
    `${hostId}__${orderId}__${memberKey}`,
  referralClaim: (hostId: string, memberKey: string): string => `${hostId}__${memberKey}`,
}

export const loyaltyRefs = {
  program: (orgId: string, hostId: string) => collection(orgId, LOYALTY_COLLECTIONS.programs).doc(hostId),
  members: (orgId: string) => collection(orgId, LOYALTY_COLLECTIONS.members),
  member: (orgId: string, hostId: string, memberKey: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.members).doc(loyaltyDocIds.member(hostId, memberKey)),
  code: (orgId: string, hostId: string, code: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.codes).doc(loyaltyDocIds.code(hostId, code)),
  ledgerCollection: (orgId: string) => collection(orgId, LOYALTY_COLLECTIONS.ledger),
  ledger: (orgId: string, hostId: string, entryKey: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.ledger).doc(loyaltyDocIds.ledger(hostId, entryKey)),
  redemption: (orgId: string, hostId: string, orderId: string, memberKey: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.redemptions).doc(
      loyaltyDocIds.redemption(hostId, orderId, memberKey),
    ),
  referralClaim: (orgId: string, hostId: string, memberKey: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.referralClaims).doc(loyaltyDocIds.referralClaim(hostId, memberKey)),
  connection: (orgId: string, hostId: string) => collection(orgId, LOYALTY_COLLECTIONS.connections).doc(hostId),
  syncCollection: (orgId: string) => collection(orgId, LOYALTY_COLLECTIONS.sync),
  /** One movement on its way to a connected account: the same id as the ledger row it mirrors. */
  sync: (orgId: string, hostId: string, entryKey: string) =>
    collection(orgId, LOYALTY_COLLECTIONS.sync).doc(loyaltyDocIds.ledger(hostId, entryKey)),
}

/** The member a `m:` reference names, or the referral an `r:` one does. */
export type LoyaltyReference =
  | { kind: 'member'; memberKey: string }
  | { kind: 'referral'; referrerKey: string; refereeKey: string }

const HEX = /^[0-9a-f]{32}$/

export function parseLoyaltyReference(reference: string): LoyaltyReference | null {
  const parts = String(reference ?? '').split(':')
  if (parts[0] === 'm' && parts.length === 2 && HEX.test(parts[1])) return { kind: 'member', memberKey: parts[1] }
  if (parts[0] === 'r' && parts.length === 3 && HEX.test(parts[1]) && HEX.test(parts[2])) {
    return { kind: 'referral', referrerKey: parts[1], refereeKey: parts[2] }
  }
  return null
}

export function memberReference(memberKey: string): string {
  return `m:${memberKey}`
}

export function referralReference(referrerKey: string, refereeKey: string): string {
  return `r:${referrerKey}:${refereeKey}`
}
