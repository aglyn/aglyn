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

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { consumeOnce } from '@aglyn/tenant-data-admin'
import { WORKSPACE_DOMAIN } from '../../../constants/workspace-domain'

/**
 * Passkey (WebAuthn) sign-in via the custom-token bridge (AGL-662).
 *
 * Firebase Auth has no passkey provider, so the ceremony is ours end to end:
 * the browser runs `navigator.credentials.create/get`, this module verifies
 * the result (via `@simplewebauthn/server` — hand-rolling COSE/CBOR signature
 * verification would be an auth bypass waiting to happen), and a verified
 * assertion is exchanged for a Firebase custom token which flows into the
 * UNCHANGED session machinery (`signInWithCustomToken` → `/api/auth/session`).
 *
 * ## RP ID — a decision baked into every stored credential
 *
 * The RP ID is the registrable parent domain `aglyn.com` (WORKSPACE_DOMAIN),
 * NOT the exact console origin. WebAuthn scopes a credential to its RP ID
 * forever: had we used `app.aglyn.com`, every credential would be unusable on
 * the `{slug}.aglyn.com` workspace subdomains AGL-627 plans, with no
 * migration path short of asking every user to re-register. The parent RP ID
 * is valid from any `*.aglyn.com` origin, so the same credential serves the
 * apex, `app.`, and future workspace hosts. The cost: any subdomain of
 * aglyn.com could run the ceremony — acceptable because every subdomain is
 * ours (Vercel domain allowlist) and the origin is still checked against
 * {@link resolveRpContext}'s allowlist on every verify.
 *
 * Localhost development uses RP ID `localhost` (the only value the browser
 * accepts there); those credentials are dev-only by construction.
 *
 * ## Storage
 *
 * - `users/{uid}/passkeys/{credentialId}` — the credential: public key,
 *   signCount, transports, label, timestamps. SERVER-WRITE ONLY (rules deny
 *   client writes; a client-writable credential store is a full auth bypass).
 *   The owner may read it for the management list.
 * - `passkeyCredentialIndex/{credentialId}` — `{ uid }`, server-only: the
 *   discoverable sign-in ceremony starts from a credential id and no uid, and
 *   this avoids a collection-group scan on the auth path.
 * - `webauthnChallenges/{challengeId}` — single-use, short-TTL, deleted in
 *   the same transaction that reads them; a replayable challenge defeats the
 *   whole ceremony. Registration challenges are bound to the uid that asked.
 *
 * ## GCIP tenants
 *
 * Passkeys are PROJECT-POOL ONLY for now. An enterprise-SSO tenant user
 * (AGL-1101) carries `firebase.tenant` on their token; registration refuses
 * them (`sso-tenant-unsupported`) and sign-in only ever mints project-pool
 * custom tokens. Half-supporting tenants would mint a pool token for a
 * tenant user and quietly fork their identity.
 *
 * ## Additive, never the sole factor
 *
 * Registration never removes or weakens any existing sign-in method — it
 * only adds a credential. Password/OAuth/SSO remain intact, so a lost
 * authenticator degrades to the pre-passkey sign-in experience.
 */

/**
 * The WebAuthn relying-party name (AGL-2153).
 *
 * Not an internal label: this is the string the OPERATING SYSTEM shows in its
 * credential prompt and stores next to the saved passkey, so on a self-host
 * install every user's password manager listed a credential for "Aglyn" —
 * a company with no relationship to the site they were signing in to. Reads
 * the platform brand, like every other user-visible name.
 *
 * `rpID` below is separate and already correct: it derives from
 * `WORKSPACE_DOMAIN` because it is a security binding (the origin the
 * credential is scoped to), not a display string.
 */
export const RP_NAME = PLATFORM_BRAND_NAME
export const CHALLENGES_COLLECTION = 'webauthnChallenges'
export const CREDENTIAL_INDEX_COLLECTION = 'passkeyCredentialIndex'
export const PASSKEYS_SUBCOLLECTION = 'passkeys'
/** Two minutes: enough for any authenticator prompt, useless to a replayer. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000
export const MAX_PASSKEYS_PER_USER = 10
export const MAX_LABEL_LENGTH = 64

export interface RpContext {
  rpID: string
  /** The exact origin the ceremony ran on, already allowlisted. */
  origin: string
}

/**
 * Derives (and gates) the RP context from the request's Origin header.
 * Returns null for an origin the ceremony must not run on — anything that is
 * not `https://` on `aglyn.com`/`*.aglyn.com`, with an `http://localhost`
 * carve-out for development.
 */
export function resolveRpContext(originHeader: string | null): RpContext | null {
  if (!originHeader) return null
  let url: URL
  try {
    url = new URL(originHeader)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) {
    return { rpID: 'localhost', origin: url.origin }
  }
  if (url.protocol !== 'https:') return null
  if (host === WORKSPACE_DOMAIN || host.endsWith(`.${WORKSPACE_DOMAIN}`)) {
    return { rpID: WORKSPACE_DOMAIN, origin: url.origin }
  }
  return null
}

/** The shape stored at `users/{uid}/passkeys/{credentialId}`. */
export interface StoredPasskey {
  /** Base64URL credential id — also the doc id. */
  credentialId: string
  /** Base64URL-encoded COSE public key. */
  publicKey: string
  /** Authenticator signature counter, for clone detection. */
  signCount: number
  transports: string[]
  label: string
  createdAt: number
  lastUsedAt: number | null
  /** Set instead of deletion when a signCount regression is seen. */
  suspectedCloneAt?: number
}

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const buffer = Buffer.from(text, 'base64url')
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length))
  bytes.set(buffer)
  return bytes
}

/** Minimal Firestore surface, injectable so specs run without an emulator. */
type Firestore = FirebaseFirestore.Firestore

function challengeRef(firestore: Firestore, id: string) {
  return firestore.collection(CHALLENGES_COLLECTION).doc(id)
}
function passkeyRef(firestore: Firestore, uid: string, credentialId: string) {
  return firestore
    .collection('users')
    .doc(uid)
    .collection(PASSKEYS_SUBCOLLECTION)
    .doc(credentialId)
}
function indexRef(firestore: Firestore, credentialId: string) {
  return firestore.collection(CREDENTIAL_INDEX_COLLECTION).doc(credentialId)
}

interface StoreChallengeParams {
  firestore: Firestore
  type: 'register' | 'signin'
  challenge: string
  /** Required for `register` — the challenge is bound to who asked. */
  uid?: string
  nowMs: number
}

async function storeChallenge(params: StoreChallengeParams): Promise<string> {
  const id = crypto.randomUUID()
  await challengeRef(params.firestore, id).set({
    type: params.type,
    challenge: params.challenge,
    uid: params.uid ?? null,
    createdAt: params.nowMs,
    // For a Firestore TTL policy, same idiom as the rate-limit buckets.
    expiresAt: new Date(params.nowMs + CHALLENGE_TTL_MS),
  })
  return id
}

/**
 * Reads AND DELETES the challenge in one transaction — single use is not a
 * policy here, it is a property: a second consume of the same id finds
 * nothing, whatever the outcome of the first.
 *
 * The transaction itself is now `consumeOnce` (AGL-1902, the D8 extraction).
 * It was private and lived in an app while the cross-domain handoff needed the
 * identical shape, and two hand-written copies of a single-use guarantee is
 * one more than is safe to have.
 *
 * Behaviour here is IDENTICAL, deliberately. `consumeOnce` does not write on a
 * refusal by default — a refused consume that deletes can destroy a record a
 * concurrent legitimate consume is about to accept — but this call site
 * deleted on every outcome before the move, so it opts back in with
 * `remove: true` on each refusal. Whether it should keep doing that is a real
 * question and a separate one; an extraction is not the change that gets to
 * decide it.
 */
async function consumeChallenge(
  firestore: Firestore,
  challengeId: string,
  expected: { type: 'register' | 'signin'; uid?: string },
  nowMs: number,
): Promise<string | null> {
  if (!challengeId) return null
  const result = await consumeOnce<string | null>(
    firestore,
    challengeRef(firestore, challengeId),
    (data) => {
      if (data['type'] !== expected.type) {
        return { accept: false, reason: 'type-mismatch', remove: true }
      }
      if (expected.type === 'register' && data['uid'] !== expected.uid) {
        return { accept: false, reason: 'uid-mismatch', remove: true }
      }
      const createdAt = Number(data['createdAt'] ?? 0)
      if (nowMs - createdAt > CHALLENGE_TTL_MS) {
        return { accept: false, reason: 'expired', remove: true }
      }
      return {
        accept: true,
        value: (data['challenge'] as string | undefined) ?? null,
        remove: true,
      }
    },
  )
  return result.ok ? (result.value ?? null) : null
}

/** Uniform error result so routes map outcomes to responses in one place. */
export type PasskeyFailure =
  | 'bad-origin'
  | 'challenge-invalid'
  | 'verification-failed'
  | 'credential-unknown'
  | 'credential-cloned'
  | 'credential-exists'
  | 'limit-reached'

export class PasskeyError extends Error {
  constructor(public readonly reason: PasskeyFailure) {
    super(reason)
    this.name = 'PasskeyError'
  }
}

export interface RegistrationOptionsParams {
  firestore: Firestore
  uid: string
  email: string | null
  originHeader: string | null
  nowMs?: number
}

/** Step 1 of registration: options + a server-stored, uid-bound challenge. */
export async function createRegistrationOptions(
  params: RegistrationOptionsParams,
): Promise<{ challengeId: string; options: unknown }> {
  const rp = resolveRpContext(params.originHeader)
  if (!rp) throw new PasskeyError('bad-origin')
  const nowMs = params.nowMs ?? Date.now()
  const existing = await params.firestore
    .collection('users')
    .doc(params.uid)
    .collection(PASSKEYS_SUBCOLLECTION)
    .get()
  if (existing.size >= MAX_PASSKEYS_PER_USER) {
    throw new PasskeyError('limit-reached')
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: params.email ?? params.uid,
    // Stable, opaque user handle: the uid — never the email, which can
    // change and would leak via the credential's user handle.
    userID: new TextEncoder().encode(params.uid),
    attestationType: 'none',
    // Prevent one authenticator holding duplicate credentials for the user.
    excludeCredentials: existing.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      transports: (docSnapshot.data() as StoredPasskey).transports as never,
    })),
    authenticatorSelection: {
      // Discoverable where possible, so the sign-in page can offer a
      // pure "use a passkey" button with no username prompt.
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })
  const challengeId = await storeChallenge({
    firestore: params.firestore,
    type: 'register',
    challenge: options.challenge,
    uid: params.uid,
    nowMs,
  })
  return { challengeId, options }
}

export interface RegistrationVerifyParams {
  firestore: Firestore
  uid: string
  originHeader: string | null
  challengeId: string
  response: RegistrationResponseJSON
  label?: string
  nowMs?: number
}

/** Step 2 of registration: verify the attestation and persist the credential. */
export async function verifyAndStoreRegistration(
  params: RegistrationVerifyParams,
): Promise<StoredPasskey> {
  const rp = resolveRpContext(params.originHeader)
  if (!rp) throw new PasskeyError('bad-origin')
  const nowMs = params.nowMs ?? Date.now()
  const challenge = await consumeChallenge(
    params.firestore,
    params.challengeId,
    { type: 'register', uid: params.uid },
    nowMs,
  )
  if (!challenge) throw new PasskeyError('challenge-invalid')
  let verified: boolean
  let registrationInfo: Awaited<
    ReturnType<typeof verifyRegistrationResponse>
  >['registrationInfo']
  try {
    ;({ verified, registrationInfo } = await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
    }))
  } catch {
    throw new PasskeyError('verification-failed')
  }
  if (!verified || !registrationInfo) {
    throw new PasskeyError('verification-failed')
  }
  const credential = registrationInfo.credential
  const credentialId = credential.id
  const stored: StoredPasskey = {
    credentialId,
    publicKey: toBase64Url(credential.publicKey),
    signCount: credential.counter,
    transports: credential.transports ?? [],
    label:
      String(params.label ?? '')
        .trim()
        .slice(0, MAX_LABEL_LENGTH) || 'Passkey',
    createdAt: nowMs,
    lastUsedAt: null,
  }
  // Credential + reverse index land atomically; a duplicated credential id
  // (same authenticator re-registered, or another user somehow presenting the
  // same id) is refused rather than silently re-owned.
  await params.firestore.runTransaction(async (tx) => {
    const index = await tx.get(indexRef(params.firestore, credentialId))
    if (index.exists) throw new PasskeyError('credential-exists')
    tx.set(passkeyRef(params.firestore, params.uid, credentialId), stored)
    tx.set(indexRef(params.firestore, credentialId), {
      uid: params.uid,
      createdAt: nowMs,
    })
  })
  return stored
}

export interface AuthenticationOptionsParams {
  firestore: Firestore
  originHeader: string | null
  nowMs?: number
}

/**
 * Step 1 of sign-in: a discoverable-credential challenge. No uid yet — the
 * assertion itself will tell us who is signing in, and the credential lookup
 * plus signature check are what make that claim trustworthy.
 */
export async function createAuthenticationOptions(
  params: AuthenticationOptionsParams,
): Promise<{ challengeId: string; options: unknown }> {
  const rp = resolveRpContext(params.originHeader)
  if (!rp) throw new PasskeyError('bad-origin')
  const nowMs = params.nowMs ?? Date.now()
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'preferred',
    allowCredentials: [],
  })
  const challengeId = await storeChallenge({
    firestore: params.firestore,
    type: 'signin',
    challenge: options.challenge,
    nowMs,
  })
  return { challengeId, options }
}

export interface AuthenticationVerifyParams {
  firestore: Firestore
  originHeader: string | null
  challengeId: string
  response: AuthenticationResponseJSON
  nowMs?: number
}

export interface VerifiedAssertion {
  uid: string
  credentialId: string
  label: string
}

/**
 * Step 2 of sign-in: consume the challenge, resolve the credential, verify
 * the assertion signature, enforce the signCount monotonic property, and
 * say WHO may be minted a token.
 *
 * The uid comes exclusively from the server-written credential index — never
 * from anything the client sent — so a token can only ever be minted for the
 * account that registered the credential that signed this challenge.
 */
export async function verifyAssertion(
  params: AuthenticationVerifyParams,
): Promise<VerifiedAssertion> {
  const rp = resolveRpContext(params.originHeader)
  if (!rp) throw new PasskeyError('bad-origin')
  const nowMs = params.nowMs ?? Date.now()
  const challenge = await consumeChallenge(
    params.firestore,
    params.challengeId,
    { type: 'signin' },
    nowMs,
  )
  if (!challenge) throw new PasskeyError('challenge-invalid')
  const credentialId = String(params.response?.id ?? '')
  if (!credentialId) throw new PasskeyError('credential-unknown')
  const index = await indexRef(params.firestore, credentialId).get()
  const uid = index.exists ? String(index.get('uid') ?? '') : ''
  if (!uid) throw new PasskeyError('credential-unknown')
  const credentialSnapshot = await passkeyRef(
    params.firestore,
    uid,
    credentialId,
  ).get()
  if (!credentialSnapshot.exists) throw new PasskeyError('credential-unknown')
  const stored = credentialSnapshot.data() as StoredPasskey
  /**
   * A flagged credential is REFUSED, not merely flagged (AGL-1881).
   *
   * `suspectedCloneAt` was written on a signCount regression below and then
   * read by nothing. It was not a control, it was a note — while the
   * management card rendered the row as **"Blocked — possible credential
   * copy"** and the sign-in error told the user the passkey "was refused for
   * security reasons".
   *
   * And the counter check alone does not survive the attack it is named
   * after. A cloned authenticator that increments normally simply catches
   * up: refused a few times, then past the stored count and accepted. One
   * whose counter is attacker-chosen is accepted on the first try and pushes
   * the stored count so far ahead that the LEGITIMATE device is the one that
   * gets flagged. So a single regression is the only signal there will ever
   * be, and discarding it after one refusal discards the whole detection.
   *
   * Once flagged it stays refused until the owner removes the credential
   * (`POST /api/auth/passkeys/remove`) and registers again — which is why
   * the refusal ships together with a delete path, and not before it. A
   * dead end that cannot be cleared is a worse product than one that never
   * claimed to block anything.
   */
  if (stored.suspectedCloneAt) throw new PasskeyError('credential-cloned')
  let verified: boolean
  let newCounter: number
  try {
    const result = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: credentialId,
        publicKey: fromBase64Url(stored.publicKey),
        counter: stored.signCount,
        transports: stored.transports as never,
      },
    })
    verified = result.verified
    newCounter = result.authenticationInfo?.newCounter ?? 0
  } catch {
    throw new PasskeyError('verification-failed')
  }
  if (!verified) throw new PasskeyError('verification-failed')
  // signCount regression = possibly a cloned authenticator replaying an
  // older counter. Authenticators that never increment always report 0 on
  // both sides, which is fine; a DECREASE from a real count is not. Flag the
  // credential and refuse the sign-in — the legitimate owner still has every
  // other factor, plus their other passkeys.
  if (stored.signCount > 0 && newCounter <= stored.signCount) {
    await passkeyRef(params.firestore, uid, credentialId).set(
      { suspectedCloneAt: nowMs },
      { merge: true },
    )
    throw new PasskeyError('credential-cloned')
  }
  await passkeyRef(params.firestore, uid, credentialId).set(
    { signCount: newCounter, lastUsedAt: nowMs },
    { merge: true },
  )
  return { uid, credentialId, label: stored.label }
}

/**
 * Remove ONE of the caller's own passkeys (AGL-1881).
 *
 * ## Why this exists
 *
 * It did not, and its absence was a security hole rather than a missing
 * nicety. A user whose laptop was stolen, or whose authenticator the
 * clone check has flagged, had no way to take the credential off the
 * account — the store is server-write-only (correctly: a client-writable
 * credential store is a full auth bypass), so with no endpoint there was no
 * path at all. Three separate strings promised otherwise: the management
 * card rendered a flagged credential as "Blocked", the sign-in failure copy
 * said to "remove it from Manage account → Security", and the registration
 * limit error said "Passkey limit reached — remove one first."
 *
 * ## The two writes, and why they are one transaction
 *
 * `users/{uid}/passkeys/{id}` is the credential; `passkeyCredentialIndex/{id}`
 * is the server-only reverse index the discoverable sign-in ceremony resolves
 * a uid from. Deleting the credential alone would leave an index row pointing
 * at a document that no longer exists — `verifyAssertion` would refuse with
 * `credential-unknown`, so it is not exploitable, but the id would stay
 * claimed and `credential-exists` would refuse the owner re-registering the
 * SAME authenticator afterwards. That is precisely what someone does after
 * a false-positive clone flag, so the two must move together.
 *
 * ## The ownership check is the whole security of this function
 *
 * The index is read INSIDE the transaction and its `uid` must equal the
 * caller's. Without that, a signed-in user could pass any credential id and
 * delete the index row belonging to somebody else's passkey — locking a
 * stranger out of a sign-in method from an authenticated session. The
 * credential document is already uid-pathed and so cannot be reached across
 * accounts, which is exactly why the index is the interesting one and why
 * this check is not redundant with it.
 *
 * Idempotent: removing a credential that is already gone reports
 * `removed: false` rather than failing, so a double-clicked button and a
 * retried request do not produce an error the user has to interpret.
 *
 * NOT a session revocation. Passkeys are additive — a removed credential
 * cannot start a NEW session, and any session it already minted lives or
 * dies by the normal session machinery. "Sign out everywhere" is the
 * separate control for that, and conflating them would make removing a
 * spare key from a keyring log everyone out.
 */
export async function deletePasskey(params: {
  firestore: Firestore
  uid: string
  credentialId: string
}): Promise<{ removed: boolean; label: string | null }> {
  const credentialId = String(params.credentialId ?? '')
  if (!credentialId) throw new PasskeyError('credential-unknown')
  return params.firestore.runTransaction(async (tx) => {
    const credentialRef = passkeyRef(params.firestore, params.uid, credentialId)
    const index = indexRef(params.firestore, credentialId)
    const [credential, indexed] = await Promise.all([
      tx.get(credentialRef),
      tx.get(index),
    ])
    // Somebody else's credential id. Refused with the same reason an unknown
    // one gets, so the endpoint does not become an oracle for which ids are
    // registered on the platform.
    if (indexed.exists && String(indexed.get('uid') ?? '') !== params.uid) {
      throw new PasskeyError('credential-unknown')
    }
    if (!credential.exists && !indexed.exists) {
      return { removed: false, label: null }
    }
    const label = credential.exists
      ? String((credential.data() as StoredPasskey)?.label ?? 'Passkey')
      : null
    if (credential.exists) tx.delete(credentialRef)
    if (indexed.exists) tx.delete(index)
    return { removed: true, label }
  })
}
