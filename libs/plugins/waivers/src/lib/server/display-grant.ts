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

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { WAIVERS_COLLECTIONS } from '../constants/bundle-common'
import { waiversDb } from './db'

/*==========================================
 * SIGNING ON THE CUSTOMER DISPLAY (AGL-4042): a grant.
 *
 * A register's paired customer display has no staff session, only the
 * display token of the plugin that runs the register, which this plugin
 * never sees. So when a staff member who may take signatures asks to sign on
 * the display, the console mints a grant: `{orgId, hostId, grantId, staff}`
 * signed with the shared, fail-closed `TOKEN_SIGNING_SECRET`, domain-separated
 * by `waiver-display:` so it can never replay as any other signature under
 * that secret. The display's page signs with it, and the signature records
 * the staff member exactly as a tablet handed over at the window does.
 *
 * It lasts UNTIL IT IS CLOSED, with no timer: staff close it from the
 * check-in beside the customer, or the display closes it as it goes back
 * (Done, Cancel, or a minute after a signing). Each grant is a document,
 * `orgs/{orgId}/waiverDisplayGrants/{grantId}`, deleted when it closes, and
 * every signing and every check reads it, so a closed grant signs nothing
 * however long its words were kept. It is good for one site's waivers; each
 * signing under it is still its own attempt, rate-limited and checked like
 * any other. It names no customer.
 *=========================================*/

const PREFIX = 'aglyn-waiver-display-v2'

/** A grant id: 32 hex characters, a Firestore document id. */
const GRANT_ID = /^[a-f0-9]{32}$/

export interface WaiverDisplayGrant {
  orgId: string
  hostId: string
  /** The grant's document, which exists while it is open. */
  grantId: string
  /** The staff member who put the waiver on the display. */
  staffUid: string
  staffName: string | null
}

/** What an open grant's document holds. */
export interface WaiverDisplayGrantRecord {
  hostId: string
  staffUid: string
  staffName: string | null
  createdAtMs: number
}

let secretOverride: (() => string) | null = null

/** Test seam. */
export function setWaiverDisplaySecretForTests(secret: (() => string) | null): void {
  secretOverride = secret
}

const sign = (payload: string): string =>
  createHmac('sha256', (secretOverride ?? tokenSigningSecret)())
    .update(`waiver-display:${payload}`)
    .digest('base64url')

function grantRef(orgId: string, grantId: string) {
  return waiversDb().collection('orgs').doc(orgId).collection(WAIVERS_COLLECTIONS.displayGrants).doc(grantId)
}

/** Whether a string is in a grant id's shape. */
export function isWaiverDisplayGrantId(value: unknown): value is string {
  return typeof value === 'string' && GRANT_ID.test(value)
}

/**
 * Mints a grant and opens it. Checks nothing about the member: only the
 * gated grant route calls it. Signs first, so a deploy with no signing
 * secret opens nothing.
 */
export async function mintWaiverDisplayGrant(
  claims: Omit<WaiverDisplayGrant, 'grantId'>,
  nowMs: number,
): Promise<{ grant: string; grantId: string }> {
  const grantId = randomBytes(16).toString('hex')
  const staffName = claims.staffName ? claims.staffName.slice(0, 120) : null
  const payload = Buffer.from(
    JSON.stringify({ orgId: claims.orgId, hostId: claims.hostId, grantId, staffUid: claims.staffUid, staffName }),
    'utf8',
  ).toString('base64url')
  const grant = `${PREFIX}.${payload}.${sign(payload)}`
  const record: WaiverDisplayGrantRecord = { hostId: claims.hostId, staffUid: claims.staffUid, staffName, createdAtMs: nowMs }
  await grantRef(claims.orgId, grantId).set(record)
  return { grant, grantId }
}

/**
 * A grant's claims as signed, or `null` for anything else: tampered,
 * malformed, another version (a v1 grant from before grants could close
 * included), or a deploy with no signing secret (fail closed). Says nothing
 * about whether it is still open: {@link openWaiverDisplayGrant} does.
 */
export function verifyWaiverDisplayGrant(grant: unknown): WaiverDisplayGrant | null {
  if (typeof grant !== 'string' || grant.length > 2000) return null
  const [prefix, payload, signature, extra] = grant.split('.')
  if (prefix !== PREFIX || !payload || !signature || extra !== undefined) return null
  let expected: string
  try {
    expected = sign(payload)
  } catch {
    return null
  }
  const given = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null
  let claims: Partial<WaiverDisplayGrant>
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<WaiverDisplayGrant>
  } catch {
    return null
  }
  if (
    typeof claims.orgId !== 'string' ||
    typeof claims.hostId !== 'string' ||
    !isWaiverDisplayGrantId(claims.grantId) ||
    typeof claims.staffUid !== 'string'
  ) {
    return null
  }
  return {
    orgId: claims.orgId,
    hostId: claims.hostId,
    grantId: claims.grantId,
    staffUid: claims.staffUid,
    staffName: typeof claims.staffName === 'string' ? claims.staffName : null,
  }
}

/**
 * A grant's claims while it is OPEN: signed by us, and its document still
 * there for the site it names. `null` once closed, and for anything
 * {@link verifyWaiverDisplayGrant} refuses.
 */
export async function openWaiverDisplayGrant(grant: unknown): Promise<WaiverDisplayGrant | null> {
  const claims = verifyWaiverDisplayGrant(grant)
  if (!claims) return null
  const snapshot = await grantRef(claims.orgId, claims.grantId).get()
  if (!snapshot.exists) return null
  const record = snapshot.data() as Partial<WaiverDisplayGrantRecord>
  return record.hostId === claims.hostId ? claims : null
}

/** Whether a grant on this site is still open, by its id (for the staff who opened one). */
export async function isWaiverDisplayGrantOpen(orgId: string, hostId: string, grantId: string): Promise<boolean> {
  if (!isWaiverDisplayGrantId(grantId)) return false
  const snapshot = await grantRef(orgId, grantId).get()
  return snapshot.exists && (snapshot.data() as Partial<WaiverDisplayGrantRecord>).hostId === hostId
}

/**
 * Closes a grant: its document goes, so nothing signs under it again. Only a
 * grant of this site closes; closing one already closed changes nothing.
 * Answers whether this call closed it.
 */
export async function closeWaiverDisplayGrant(orgId: string, hostId: string, grantId: string): Promise<boolean> {
  if (!isWaiverDisplayGrantId(grantId)) return false
  const ref = grantRef(orgId, grantId)
  const snapshot = await ref.get()
  if (!snapshot.exists || (snapshot.data() as Partial<WaiverDisplayGrantRecord>).hostId !== hostId) return false
  await ref.delete()
  return true
}
