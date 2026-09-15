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

import { consumeOnce } from '@aglyn/tenant-data-admin/server/consume-once'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { safeEqual } from '@aglyn/tenant-data-admin/server/safe-equal'
import { createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * THE OAUTH `state` FOR A MAILBOX CONNECT (AGL-2978): signed, short-lived,
 * single-use, and bound to one member of one organization.
 *
 * ## Signed
 *
 * `os1.<payload>.<signature>`, the payload `{ o: orgId, u: uid, n: nonce,
 * e: expiry }` and the signature an HMAC under the shared, fail-closed
 * `TOKEN_SIGNING_SECRET` with its own `outreach-oauth-state:` context — the
 * construction every other signed token here uses, and domain-separated from
 * all of them. Google hands the state back verbatim, so a state that verifies
 * names the org and the member it was minted for. The console dispatcher
 * reads exactly that to ask its release gate about the right organization on
 * a redirect that carries no bearer token.
 *
 * ## Single-use
 *
 * A signature proves who minted a state, not that it is fresh. Each connect
 * also writes ONE pending record per member per organization, at
 * `outreachOAuthStates/{sha256(orgId, uid)}`, holding the SHA-256 of the
 * state's nonce, its expiry and the redirect address the code was issued
 * for. Finishing a connect consumes that record in a transaction
 * (`consumeOnce`), so a second use of the same state finds nothing, and
 * starting another connect replaces the record, retiring every earlier state.
 * The collection is closed to every client.
 *
 * ## Derived, not stored
 *
 * The PKCE verifier and the OpenID `nonce` are HMACs of the state's nonce
 * under the same secret, each with its own context. Nothing secret is stored
 * for them, and only this server can recompute either — a state copied off a
 * redirect is not enough to redeem its code.
 */

export const OUTREACH_OAUTH_STATES_COLLECTION = 'outreachOAuthStates'

/** How long a rep has to finish Google's consent screen. */
export const OUTREACH_OAUTH_STATE_TTL_MS = 10 * 60 * 1000

const STATE_VERSION = 'os1'
const STATE_CONTEXT = 'outreach-oauth-state:v1'
const PKCE_CONTEXT = 'outreach-oauth-pkce:v1'
const OIDC_NONCE_CONTEXT = 'outreach-oauth-oidc-nonce:v1'
const STATE_MAX_CHARS = 1024

export interface OutreachOAuthStateClaims {
  orgId: string
  uid: string
  nonce: string
  /** Expiry, epoch ms. */
  exp: number
}

interface WireClaims {
  o: string
  u: string
  n: string
  e: number
}

const hmac = (context: string, value: string): string =>
  createHmac('sha256', tokenSigningSecret()).update(`${context}:${value}`).digest('base64url')

/**
 * Mints a state for a member's connect. Throws when `TOKEN_SIGNING_SECRET` is
 * not configured; the route answers that as a deployment that cannot connect.
 */
export function mintOutreachOAuthState(input: {
  orgId: string
  uid: string
  nowMs: number
  /** Test seam; a random 32 bytes otherwise. */
  nonce?: string
}): { state: string; claims: OutreachOAuthStateClaims } {
  const claims: OutreachOAuthStateClaims = {
    orgId: input.orgId,
    uid: input.uid,
    nonce: input.nonce ?? randomBytes(32).toString('base64url'),
    exp: input.nowMs + OUTREACH_OAUTH_STATE_TTL_MS,
  }
  const wire: WireClaims = { o: claims.orgId, u: claims.uid, n: claims.nonce, e: claims.exp }
  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')
  return { state: `${STATE_VERSION}.${payload}.${hmac(STATE_CONTEXT, payload)}`, claims }
}

export type OutreachOAuthStateRead =
  | { ok: true; claims: OutreachOAuthStateClaims }
  /** Authentic and past its expiry — the claims can still say whose it was. */
  | { ok: false; refusal: 'state-expired'; claims: OutreachOAuthStateClaims }
  /** Tampered, truncated, another version, or no secret to check it with. */
  | { ok: false; refusal: 'state-invalid' }

/** Verifies a state's signature and expiry. Never throws. */
export function readOutreachOAuthState(state: unknown, nowMs: number): OutreachOAuthStateRead {
  const invalid = { ok: false, refusal: 'state-invalid' } as const
  if (typeof state !== 'string' || !state || state.length > STATE_MAX_CHARS) return invalid
  const parts = state.split('.')
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) return invalid
  const [, payload, signature] = parts
  let expected: string
  try {
    expected = hmac(STATE_CONTEXT, payload)
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
  const claims: OutreachOAuthStateClaims = {
    orgId: typeof wire?.o === 'string' ? wire.o : '',
    uid: typeof wire?.u === 'string' ? wire.u : '',
    nonce: typeof wire?.n === 'string' ? wire.n : '',
    exp: Number(wire?.e),
  }
  if (!claims.orgId || !claims.uid || !claims.nonce || !Number.isFinite(claims.exp)) return invalid
  if (claims.exp <= nowMs) return { ok: false, refusal: 'state-expired', claims }
  return { ok: true, claims }
}

/** The PKCE `code_verifier` for a state's nonce: 43 base64url characters. */
export function outreachPkceVerifier(nonce: string): string {
  return hmac(PKCE_CONTEXT, nonce)
}

/** The OpenID `nonce` Google must echo in the ID token for this connect. */
export function outreachOidcNonce(nonce: string): string {
  return hmac(OIDC_NONCE_CONTEXT, nonce)
}

/** The pending record's id: one per member per organization. */
export function outreachOAuthStateDocId(orgId: string, uid: string): string {
  return createHash('sha256').update(`${orgId}\n${uid}`).digest('hex')
}

const digest = (nonce: string) => createHash('sha256').update(nonce).digest('base64url')

/** `outreachOAuthStates/{id}` — see the module comment. */
export interface OutreachOAuthStateRecord {
  orgId: string
  uid: string
  /** SHA-256 of the state's nonce; the nonce itself is never stored. */
  nonceDigest: string
  /** The redirect address the authorization code was issued for. */
  redirectUri: string
  expiresAtMs: number
  createdAtMs: number
}

/**
 * Writes the pending record for a freshly minted state, replacing any earlier
 * one for the same member and organization.
 */
export async function recordOutreachOAuthState(
  firestore: FirebaseFirestore.Firestore,
  input: { claims: OutreachOAuthStateClaims; redirectUri: string; nowMs: number },
): Promise<void> {
  const { claims } = input
  const record: OutreachOAuthStateRecord = {
    orgId: claims.orgId,
    uid: claims.uid,
    nonceDigest: digest(claims.nonce),
    redirectUri: input.redirectUri,
    expiresAtMs: claims.exp,
    createdAtMs: input.nowMs,
  }
  await firestore
    .collection(OUTREACH_OAUTH_STATES_COLLECTION)
    .doc(outreachOAuthStateDocId(claims.orgId, claims.uid))
    .set(record)
}

export type OutreachOAuthStateConsumed =
  | { ok: true; redirectUri: string }
  /** No pending record: this state was already used, or never recorded. */
  | { ok: false; refusal: 'state-replayed' }
  /** A later connect by the same member replaced this state. */
  | { ok: false; refusal: 'state-superseded' }
  | { ok: false; refusal: 'state-expired' }

/**
 * Consumes the pending record a verified state names — once. A superseded
 * state leaves the newer record standing for the connect that owns it.
 */
export async function consumeOutreachOAuthState(
  firestore: FirebaseFirestore.Firestore,
  input: { claims: OutreachOAuthStateClaims; nowMs: number },
): Promise<OutreachOAuthStateConsumed> {
  const { claims } = input
  const ref = firestore
    .collection(OUTREACH_OAUTH_STATES_COLLECTION)
    .doc(outreachOAuthStateDocId(claims.orgId, claims.uid))
  const result = await consumeOnce<string>(firestore, ref, (data) => {
    if (data['orgId'] !== claims.orgId || data['uid'] !== claims.uid) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (!safeEqual(String(data['nonceDigest'] ?? ''), digest(claims.nonce))) {
      return { accept: false, reason: 'state-superseded' }
    }
    if (Number(data['expiresAtMs']) <= input.nowMs) {
      // Nobody can accept an expired record, so removing it destroys nothing
      // a concurrent consume could have used.
      return { accept: false, reason: 'state-expired', remove: true }
    }
    return { accept: true, value: String(data['redirectUri'] ?? ''), remove: true }
  })
  if (result.ok && result.value) return { ok: true, redirectUri: result.value }
  if (result.reason === 'state-superseded') return { ok: false, refusal: 'state-superseded' }
  if (result.reason === 'state-expired') return { ok: false, refusal: 'state-expired' }
  return { ok: false, refusal: 'state-replayed' }
}
