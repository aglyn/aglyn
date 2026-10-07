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
import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, getPluginConfig } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  POS_CASHIER_ASSERTION_TTL_MS,
  POS_MANAGER_ASSERTION_TTL_MS,
} from '../model/commerce-pos-ops'
import type { PrintReport } from '../model/commerce-printers'
import { posOpsSettings, type PosOpsSettings } from '../pos-ops-config'

/*==========================================
 * WHO MAY RUN THE REGISTER (AGL-3609), for the shift, PIN, customer and
 * return routes.
 *
 * The same two facts the sale route checks: the member's role ON THIS SITE
 * is `admin` or `editor` (the allowlist the Firestore rules enforce), and the
 * organization has not revoked `managePos` from them. Plus the plan's `pos`
 * entitlement, re-read every time because a downgrade happens between taps.
 *
 * Every Firebase and Stripe touch goes through {@link PosOpsDeps}, so the
 * routes' specs run each money path against an in-memory store and a counted
 * fetch without mocking a module.
 *=========================================*/

export interface PosOpsMembership {
  orgWide: boolean
  hostRole: string | null
  permissions: { managePos?: boolean }
}

export interface PosOpsDeps {
  firestore(): FirebaseFirestore.Firestore
  verifyIdToken(token: string): Promise<{ uid: string }>
  membership(uid: string, hostId: string): Promise<PosOpsMembership>
  orgForHost(hostId: string): Promise<{ orgId: string; org: Record<string, any> | null } | null>
  pluginConfig(orgId: string, hostId: string): Promise<Record<string, unknown>>
  /** The plan includes the register. */
  posEntitled(org: Record<string, any> | null): boolean
  /** The HMAC secret staff assertions are signed with; throws when unset. */
  signingSecret(): string
  /** A member's name as a receipt or a report prints it. */
  memberName(uid: string): Promise<string>
  now(): number
  /** Stripe's REST API; `global.fetch` in production. */
  fetch: typeof fetch
  /** The register's cloud printers (AGL-3619): drawer kicks and shift reports. */
  printer: PosOpsPrinter
}

/** What the register's routes ask of the printer queue. Never throws. */
export interface PosOpsPrinter {
  kickDrawer(input: {
    hostId: string
    registerId: string
    reason: 'paid_in' | 'paid_out' | 'drop' | 'cash_refund'
    causeId: string
    createdBy?: string
  }): Promise<{ jobIds: string[] }>
  printReport(input: {
    hostId: string
    registerId: string
    shiftId: string
    report: PrintReport
    createdBy?: string
    attemptKey: string
  }): Promise<{ jobIds: string[] }>
}

export function defaultPosOpsDeps(): PosOpsDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    verifyIdToken: async (token) => {
      const decoded = await firebaseAdmin.app().auth().verifyIdToken(token)
      return { uid: decoded.uid }
    },
    membership: async (uid, hostId) => {
      const resolved = await resolveOrgPermissions(uid, { hostId })
      return {
        orgWide: resolved.orgWide === true,
        hostRole: resolved.hostRole ?? null,
        permissions: { managePos: resolved.permissions?.managePos === true },
      }
    },
    orgForHost: async (hostId) => {
      const found = await getOrgForHost(hostId)
      if (!found) return null
      return {
        orgId: String(found.org?.id ?? found.orgId ?? ''),
        org: (found.org as Record<string, any>) ?? null,
      }
    },
    pluginConfig: async (orgId, hostId) =>
      ((await getPluginConfig(orgId, 'commerce', { hostId })) ?? {}) as Record<string, unknown>,
    posEntitled: (org) => Aglyn.checkEntitlement(org as any, 'pos'),
    signingSecret: () => {
      const secret = process.env.TOKEN_SIGNING_SECRET
      if (!secret) throw new Error('TOKEN_SIGNING_SECRET is not configured')
      return secret
    },
    memberName: async (uid) => {
      try {
        const user = await firebaseAdmin.app().auth().getUser(uid)
        return user.displayName || user.email || 'Staff member'
      } catch {
        return 'Staff member'
      }
    },
    now: () => Date.now(),
    fetch: (input, init) => fetch(input, init),
    // Loaded on use: the printing module reaches the whole sale pipeline,
    // which a shift count or a PIN check never needs.
    printer: {
      kickDrawer: async (input) => (await import('./pos-print')).kickPosDrawer(input),
      printReport: async (input) => (await import('./pos-print')).printPosShiftReport(input),
    },
  }
}

/** A JSON body, whether the dispatcher parsed it or not. */
export function posOpsBody(req: PluginApiRequest): Record<string, any> {
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, any>) : {}
}

/** The request's idempotency key, either header spelling, bounded. */
export function posOpsIdempotencyKey(req: PluginApiRequest): string {
  return String(req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '')
    .trim()
    .slice(0, 200)
}

/** Who is at the register, once the gate admitted them. */
export interface PosOpsStaff {
  uid: string
  hostId: string
  orgId: string
  org: Record<string, any> | null
  membership: PosOpsMembership
  /** An admin of the whole workspace: the one role with no refund limit. */
  isManager: boolean
  settings: PosOpsSettings
  hostRef: FirebaseFirestore.DocumentReference
}

export type PosOpsGate =
  | { ok: true; staff: PosOpsStaff }
  | { ok: false; status: number; error: string }

/** A site id the dispatcher's own sentinels and path tricks cannot pass for. */
function cleanId(value: unknown): string {
  const id = String(value ?? '').trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^__.*__$/.test(id) ? id : ''
}

export { cleanId as posOpsCleanId }

/** Whether a member may work this site's register, by role and permission. */
export function mayWorkRegister(memberRole: unknown, membership: PosOpsMembership): boolean {
  return (memberRole === 'admin' || memberRole === 'editor') && membership.permissions.managePos === true
}

/**
 * The one role whose say-so a refund above the cashier limit needs: an admin
 * of the whole workspace who is also this site's admin — the role
 * `refund.ts` has always required to refund at all.
 */
export function isPosManager(memberRole: unknown, membership: PosOpsMembership): boolean {
  return memberRole === 'admin' && membership.orgWide && membership.hostRole === 'admin'
}

export async function authorizePosOps(
  deps: PosOpsDeps,
  req: PluginApiRequest,
  rawHostId: unknown,
): Promise<PosOpsGate> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  const hostId = cleanId(rawHostId)
  if (!hostId) return { ok: false, status: 400, error: 'Missing hostId' }
  let uid: string
  try {
    uid = (await deps.verifyIdToken(idToken)).uid
  } catch {
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const hostRef = deps.firestore().collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) return { ok: false, status: 404, error: 'Unknown site' }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[uid]
  const membership = await deps.membership(uid, hostId)
  if (!mayWorkRegister(memberRole, membership)) {
    return { ok: false, status: 403, error: 'Not permitted' }
  }
  const owner = await deps.orgForHost(hostId)
  if (!deps.posEntitled(owner?.org ?? null)) {
    return { ok: false, status: 403, error: 'POS requires the Pro plan or above' }
  }
  const settings = posOpsSettings(
    owner?.orgId ? await deps.pluginConfig(owner.orgId, hostId).catch(() => ({})) : {},
  )
  return {
    ok: true,
    staff: {
      uid,
      hostId,
      orgId: owner?.orgId ?? '',
      org: owner?.org ?? null,
      membership,
      isManager: isPosManager(memberRole, membership),
      settings,
      hostRef,
    },
  }
}

/** A register on this site, or a refusal: a register id from another site is unknown here. */
export async function readPosRegister(
  staff: PosOpsStaff,
  rawRegisterId: unknown,
): Promise<
  | { ok: true; ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }
  | { ok: false; status: number; error: string }
> {
  const registerId = cleanId(rawRegisterId)
  if (!registerId) return { ok: false, status: 400, error: 'Missing registerId' }
  const ref = staff.hostRef.collection('registers').doc(registerId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return { ok: false, status: 404, error: 'Unknown register' }
  return { ok: true, ref, data: (snapshot.data() ?? {}) as Record<string, any> }
}

/*==========================================
 * STAFF ASSERTIONS: what a PIN buys.
 *
 * A PIN never signs anybody in. It mints a short-lived, signed statement
 * that one member of THIS site is at THIS register — `{hostId, registerId,
 * memberUid, purpose, expiry}` under an HMAC — and the routes that take one
 * re-check that member's role and `managePos` on every use, so a PIN never
 * carries more than its member holds right now, and a revoked member's
 * assertion stops working on the next tap rather than at expiry.
 *=========================================*/

export type PosAssertionPurpose = 'cashier' | 'manager'

interface AssertionClaims {
  v: 1
  h: string
  r: string
  u: string
  p: PosAssertionPurpose
  e: number
}

function signClaims(deps: PosOpsDeps, payload: string): string {
  return createHmac('sha256', deps.signingSecret()).update(`pos-assertion:${payload}`).digest('hex')
}

export function mintPosAssertion(
  deps: PosOpsDeps,
  input: { hostId: string; registerId: string; memberUid: string; purpose: PosAssertionPurpose },
): { token: string; expiresAtMs: number } {
  const expiresAtMs =
    deps.now() +
    (input.purpose === 'manager' ? POS_MANAGER_ASSERTION_TTL_MS : POS_CASHIER_ASSERTION_TTL_MS)
  const claims: AssertionClaims = {
    v: 1,
    h: input.hostId,
    r: input.registerId,
    u: input.memberUid,
    p: input.purpose,
    e: expiresAtMs,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return { token: `${payload}.${signClaims(deps, payload)}`, expiresAtMs }
}

/**
 * The member an assertion names, or `null` — for a forged, expired, wrong-site,
 * wrong-register or wrong-purpose one alike. It does NOT re-check the member:
 * {@link resolvePosStaffAssertion} does that.
 */
export function readPosAssertion(
  deps: PosOpsDeps,
  token: unknown,
  expected: { hostId: string; registerId: string; purpose: PosAssertionPurpose },
): { memberUid: string; expiresAtMs: number } | null {
  const value = typeof token === 'string' ? token.trim() : ''
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || value.length > 2000) return null
  const payload = value.slice(0, dot)
  const signature = value.slice(dot + 1)
  let expected64: string
  try {
    expected64 = signClaims(deps, payload)
  } catch {
    return null
  }
  const a = Buffer.from(signature)
  const b = Buffer.from(expected64)
  if (a.length !== b.length || !timingSafeEqual(new Uint8Array(a), new Uint8Array(b))) return null
  let claims: AssertionClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (
    claims?.v !== 1 ||
    claims.h !== expected.hostId ||
    claims.r !== expected.registerId ||
    claims.p !== expected.purpose ||
    typeof claims.u !== 'string' ||
    !claims.u ||
    !(Number(claims.e) > deps.now())
  ) {
    return null
  }
  return { memberUid: claims.u, expiresAtMs: Number(claims.e) }
}

/**
 * The member an assertion puts at the register, re-checked NOW against the
 * site's roles and the organization's permissions — or `null` when the
 * assertion is bad or the member may no longer do what it was minted for.
 */
export async function resolvePosStaffAssertion(
  deps: PosOpsDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  token: unknown,
  expected: { hostId: string; registerId: string; purpose: PosAssertionPurpose },
): Promise<string | null> {
  const read = readPosAssertion(deps, token, expected)
  if (!read) return null
  const host = await hostRef.get()
  const memberRole = (host.get('memberRoles') ?? {})[read.memberUid]
  const membership = await deps.membership(read.memberUid, expected.hostId)
  const allowed =
    expected.purpose === 'manager'
      ? isPosManager(memberRole, membership)
      : mayWorkRegister(memberRole, membership)
  return allowed ? read.memberUid : null
}

/**
 * Who rang this: the member a valid cashier assertion names, or the member
 * signed in on the device when there is none or it no longer holds. The
 * signed-in member already passed the gate, so the fallback never admits
 * anybody new; it only decides whose name the sale carries.
 */
export async function resolvePosCashier(
  deps: PosOpsDeps,
  staff: Pick<PosOpsStaff, 'uid' | 'hostId' | 'hostRef'>,
  registerId: string,
  token: unknown,
): Promise<{ cashierId: string; via: 'pin' | 'session' }> {
  if (token) {
    const memberUid = await resolvePosStaffAssertion(deps, staff.hostRef, token, {
      hostId: staff.hostId,
      registerId,
      purpose: 'cashier',
    })
    if (memberUid) return { cashierId: memberUid, via: 'pin' }
  }
  return { cashierId: staff.uid, via: 'session' }
}
