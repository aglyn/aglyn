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

/**
 * THE OAUTH `state` FOR A LEDGER CONNECT (AGL-3614): signed, short-lived,
 * single-use, and bound to one member of one organization — the construction
 * Sequences' mailbox connect proved (AGL-2978), with its own contexts.
 *
 * ## Signed
 *
 * `as1.<payload>.<signature>`, the payload `{ o: orgId, u: uid, n: nonce,
 * e: expiry, p: provider }` and the signature an HMAC under the shared,
 * fail-closed `TOKEN_SIGNING_SECRET` with the context `accounting-oauth-state:`,
 * domain-separated from every other signed token here. Intuit and Xero hand
 * the state back verbatim, so a state that verifies names the organization,
 * the member and the provider whose consent screen it went to. The console
 * dispatcher reads exactly that to ask its release gate about the right
 * organization on a redirect that carries no bearer token.
 *
 * ## Single-use
 *
 * A signature proves who minted a state, not that it is fresh. Each connect
 * also writes ONE pending record per member per organization, at
 * `orgs/{orgId}/accountingOAuthStates/{sha256(orgId, uid)}`, holding the
 * SHA-256 of the state's nonce, its expiry and the redirect address the code
 * was issued for. Finishing a connect consumes the record in a transaction
 * (`consumeOnce`), so a second use finds nothing, and starting another
 * connect replaces it, retiring every earlier state.
 *
 * No Firestore rule names the collection, and the org block has no
 * catch-all, so every client is refused it — a client that could write one
 * could re-arm a consumed state.
 */

import { consumeOnce } from '@aglyn/tenant-data-admin/server/consume-once'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { safeEqual } from '@aglyn/tenant-data-admin/server/safe-equal'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import {
  ACCOUNTING_OAUTH_STATES_COLLECTION,
  isAccountingProviderId,
  type AccountingProviderId,
} from '../model/accounting.types'

/** How long a member has to finish the provider's consent screen. */
export const ACCOUNTING_OAUTH_STATE_TTL_MS = 15 * 60 * 1000

const STATE_VERSION = 'as1'
const STATE_CONTEXT = 'accounting-oauth-state:v1'
const STATE_MAX_CHARS = 1024

export interface AccountingOAuthStateClaims {
  orgId: string
  uid: string
  nonce: string
  /** Expiry, epoch ms. */
  exp: number
  provider: AccountingProviderId
}

interface WireClaims {
  o: string
  u: string
  n: string
  e: number
  p: string
}

const hmac = (value: string): string =>
  createHmac('sha256', tokenSigningSecret()).update(`${STATE_CONTEXT}:${value}`).digest('base64url')

/** Mints a state. Throws when `TOKEN_SIGNING_SECRET` is not configured. */
export function mintAccountingOAuthState(input: {
  orgId: string
  uid: string
  provider: AccountingProviderId
  nowMs: number
  /** Test seam; 32 random bytes otherwise. */
  nonce?: string
}): { state: string; claims: AccountingOAuthStateClaims } {
  const claims: AccountingOAuthStateClaims = {
    orgId: input.orgId,
    uid: input.uid,
    nonce: input.nonce ?? randomBytes(32).toString('base64url'),
    exp: input.nowMs + ACCOUNTING_OAUTH_STATE_TTL_MS,
    provider: input.provider,
  }
  const wire: WireClaims = { o: claims.orgId, u: claims.uid, n: claims.nonce, e: claims.exp, p: claims.provider }
  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')
  return { state: `${STATE_VERSION}.${payload}.${hmac(payload)}`, claims }
}

export type AccountingOAuthStateRead =
  | { ok: true; claims: AccountingOAuthStateClaims }
  /** Authentic and past its expiry — the claims still say whose it was. */
  | { ok: false; refusal: 'state-expired'; claims: AccountingOAuthStateClaims }
  /** Tampered, truncated, another version, or no secret to check it with. */
  | { ok: false; refusal: 'state-invalid' }

/** Verifies a state's signature and expiry. Never throws. */
export function readAccountingOAuthState(state: unknown, nowMs: number): AccountingOAuthStateRead {
  const invalid = { ok: false, refusal: 'state-invalid' } as const
  if (typeof state !== 'string' || !state || state.length > STATE_MAX_CHARS) return invalid
  const parts = state.split('.')
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) return invalid
  const [, payload, signature] = parts
  let expected: string
  try {
    expected = hmac(payload)
  } catch {
    return invalid
  }
  if (!safeEqual(signature, expected)) return invalid
  let wire: Partial<WireClaims>
  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<WireClaims>
  } catch {
    return invalid
  }
  if (!isAccountingProviderId(wire?.p)) return invalid
  const claims: AccountingOAuthStateClaims = {
    orgId: typeof wire.o === 'string' ? wire.o : '',
    uid: typeof wire.u === 'string' ? wire.u : '',
    nonce: typeof wire.n === 'string' ? wire.n : '',
    exp: Number(wire.e),
    provider: wire.p,
  }
  if (!claims.orgId || !claims.uid || !claims.nonce || !Number.isFinite(claims.exp)) return invalid
  if (claims.exp <= nowMs) return { ok: false, refusal: 'state-expired', claims }
  return { ok: true, claims }
}

/** The pending record's id: one per member per organization. */
export function accountingOAuthStateDocId(orgId: string, uid: string): string {
  return createHash('sha256').update(`${orgId}\n${uid}`).digest('hex')
}

export function accountingOAuthStateRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(ACCOUNTING_OAUTH_STATES_COLLECTION)
    .doc(accountingOAuthStateDocId(orgId, uid))
}

const digest = (nonce: string) => createHash('sha256').update(nonce).digest('base64url')

/** Writes the pending record for a freshly minted state, replacing any earlier one. */
export async function recordAccountingOAuthState(
  firestore: FirebaseFirestore.Firestore,
  input: { claims: AccountingOAuthStateClaims; redirectUri: string; nowMs: number },
): Promise<void> {
  const { claims } = input
  await accountingOAuthStateRef(firestore, claims.orgId, claims.uid).set({
    orgId: claims.orgId,
    uid: claims.uid,
    provider: claims.provider,
    nonceDigest: digest(claims.nonce),
    redirectUri: input.redirectUri,
    expiresAtMs: claims.exp,
    createdAtMs: input.nowMs,
  })
}

export type AccountingOAuthStateConsumed =
  | { ok: true; redirectUri: string }
  | { ok: false; refusal: 'state-replayed' | 'state-superseded' | 'state-expired' }

/** Consumes the pending record a verified state names — once. */
export async function consumeAccountingOAuthState(
  firestore: FirebaseFirestore.Firestore,
  input: { claims: AccountingOAuthStateClaims; nowMs: number },
): Promise<AccountingOAuthStateConsumed> {
  const { claims } = input
  const ref = accountingOAuthStateRef(firestore, claims.orgId, claims.uid)
  const result = await consumeOnce<string>(firestore, ref, (data) => {
    if (data['orgId'] !== claims.orgId || data['uid'] !== claims.uid || data['provider'] !== claims.provider) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (!safeEqual(String(data['nonceDigest'] ?? ''), digest(claims.nonce))) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (Number(data['expiresAtMs']) <= input.nowMs) {
      return { accept: false, reason: 'state-expired', remove: true }
    }
    return { accept: true, value: String(data['redirectUri'] ?? ''), remove: true }
  })
  if (result.ok && result.value) return { ok: true, redirectUri: result.value }
  if (result.reason === 'state-superseded') return { ok: false, refusal: 'state-superseded' }
  if (result.reason === 'state-expired') return { ok: false, refusal: 'state-expired' }
  return { ok: false, refusal: 'state-replayed' }
}
