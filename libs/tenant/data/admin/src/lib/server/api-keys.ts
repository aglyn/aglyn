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
 * Customer API keys (AGL-616). Keys authenticate the public REST API
 * (`/api/v1/**`). Only a SHA-256 hash of the key is ever stored — the raw
 * token is shown to the user exactly once, at creation. The Firestore doc id
 * IS the hash, so verification is an O(1) `get()` and the hash never leaves
 * the server (listings return metadata only). The `apiKeys` collection is
 * deny-all in the security rules; all access is Admin-SDK only.
 *
 * The token/hash/format/scope helpers are pure and unit-tested; the storage
 * functions wrap the Admin SDK.
 */
import { createHash, randomBytes } from 'node:crypto'
import { firebaseAdmin } from './firebase-admin'

/** Scopes a key can be granted, as `resource:action`. */
export const API_SCOPES = [
  'datasets:read',
  'datasets:write',
  'contacts:read',
  'contacts:write',
  'sites:read',
  'forms:read',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

/** Live-key token prefix. A `_test_` variant can follow the same shape later. */
export const API_KEY_TOKEN_PREFIX = 'aglyn_sk_'

/** Top-level collection; doc id = the token hash. */
export const API_KEYS_COLLECTION = 'apiKeys'

/** How much of the raw token is retained (plaintext) for display/identification. */
const DISPLAY_BODY_CHARS = 6

/** Stored document. `createdAt`/`lastUsedAt`/etc. are Firestore Timestamps. */
export interface ApiKeyDocument {
  /** Public, stable id shown in the UI and used for revoke (never the hash). */
  keyId: string
  orgId: string
  name: string
  /** e.g. `aglyn_sk_ab12cd…` — enough to recognize a key, not to use it. */
  keyPrefix: string
  scopes: ApiScope[]
  createdBy: string
  createdAt: FirebaseFirestore.Timestamp
  lastUsedAt: FirebaseFirestore.Timestamp | null
  revokedAt: FirebaseFirestore.Timestamp | null
  expiresAt: FirebaseFirestore.Timestamp | null
}

/** Metadata safe to return to a client (no hash, no raw token). */
export interface PublicApiKey {
  keyId: string
  name: string
  keyPrefix: string
  scopes: ApiScope[]
  createdAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
}

/** The resolved principal after a successful key verification. */
export interface VerifiedApiKey {
  orgId: string
  keyId: string
  scopes: ApiScope[]
}

// ── Pure helpers (unit-tested; no I/O) ──────────────────────────────────────

/** True if `value` is one of the known scopes. */
export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value)
}

/** Keep only valid, de-duplicated scopes, preserving `API_SCOPES` order. */
export function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const set = new Set(scopes.filter(isApiScope) as ApiScope[])
  return API_SCOPES.filter((scope) => set.has(scope))
}

/** SHA-256 hex of a raw token — the Firestore doc id and lookup key. */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Structural check before hashing/looking up — cheap reject of junk input. */
export function isValidApiKeyFormat(token: string): boolean {
  return (
    typeof token === 'string' &&
    token.startsWith(API_KEY_TOKEN_PREFIX) &&
    /^[A-Za-z0-9_-]{24,}$/.test(token.slice(API_KEY_TOKEN_PREFIX.length))
  )
}

/**
 * Generate a fresh token plus the derived hash and display prefix. The raw
 * `token` is the only time the secret exists in plaintext — persist the hash,
 * hand the token to the user once.
 */
export function generateApiKeyToken(): {
  token: string
  hash: string
  keyPrefix: string
} {
  const body = randomBytes(24).toString('base64url')
  const token = `${API_KEY_TOKEN_PREFIX}${body}`
  return {
    token,
    hash: hashApiKey(token),
    keyPrefix: `${API_KEY_TOKEN_PREFIX}${body.slice(0, DISPLAY_BODY_CHARS)}…`,
  }
}

/** True when the granted scopes include the one an operation requires. */
export function hasScope(
  granted: readonly ApiScope[],
  required: ApiScope,
): boolean {
  return granted.includes(required)
}

/** A random public key id (`key_…`), distinct from the secret and its hash. */
export function generateKeyId(): string {
  return `key_${randomBytes(9).toString('base64url')}`
}

// ── Storage (Admin SDK) ─────────────────────────────────────────────────────

function collection() {
  return firebaseAdmin.app().firestore().collection(API_KEYS_COLLECTION)
}

const tsToIso = (
  value: FirebaseFirestore.Timestamp | null | undefined,
): string | null => (value ? value.toDate().toISOString() : null)

/** Public projection of a stored key — never includes the hash/doc id. */
export function toPublicApiKey(doc: ApiKeyDocument): PublicApiKey {
  return {
    keyId: doc.keyId,
    name: doc.name,
    keyPrefix: doc.keyPrefix,
    scopes: doc.scopes ?? [],
    createdAt: tsToIso(doc.createdAt),
    lastUsedAt: tsToIso(doc.lastUsedAt),
    revokedAt: tsToIso(doc.revokedAt),
    expiresAt: tsToIso(doc.expiresAt),
  }
}

export interface MintApiKeyInput {
  orgId: string
  name: string
  scopes: readonly string[]
  createdBy: string
  /** Optional absolute expiry, epoch ms. */
  expiresAtMs?: number | null
}

/**
 * Create a key for an org. Returns the raw `token` (show once) and the public
 * metadata. Invalid scopes are dropped; at least one valid scope is required.
 */
export async function mintApiKey(
  input: MintApiKeyInput,
): Promise<{ token: string; key: PublicApiKey }> {
  const scopes = normalizeScopes(input.scopes)
  if (scopes.length === 0) {
    throw new Error('An API key needs at least one valid scope')
  }
  const { Timestamp, FieldValue } = firebaseAdmin.firestore
  const { token, hash, keyPrefix } = generateApiKeyToken()
  const keyId = generateKeyId()
  const expiresAt =
    input.expiresAtMs != null ? Timestamp.fromMillis(input.expiresAtMs) : null

  const doc = {
    keyId,
    orgId: input.orgId,
    name: input.name.slice(0, 120),
    keyPrefix,
    scopes,
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
    expiresAt,
  }
  // `create` (not set) so a hash collision can never overwrite another key.
  await collection().doc(hash).create(doc)

  return {
    token,
    key: {
      keyId,
      name: doc.name,
      keyPrefix,
      scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null,
    },
  }
}

/**
 * Resolve a raw token to its org/scopes, or `null` if it is malformed,
 * unknown, revoked, or expired. Refreshes `lastUsedAt` at most once a minute
 * (fire-and-forget) to avoid a write on every request.
 */
export async function verifyApiKey(
  token: string,
): Promise<VerifiedApiKey | null> {
  if (!isValidApiKeyFormat(token)) return null
  const snap = await collection().doc(hashApiKey(token)).get()
  if (!snap.exists) return null
  const data = snap.data() as ApiKeyDocument

  if (data.revokedAt) return null
  const now = Date.now()
  if (data.expiresAt && data.expiresAt.toMillis() <= now) return null

  const lastUsedMs = data.lastUsedAt ? data.lastUsedAt.toMillis() : 0
  if (now - lastUsedMs > 60_000) {
    snap.ref
      .update({ lastUsedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() })
      .catch(() => undefined)
  }

  return { orgId: data.orgId, keyId: data.keyId, scopes: data.scopes ?? [] }
}

/** All keys for an org, newest first (metadata only). */
export async function listApiKeys(orgId: string): Promise<PublicApiKey[]> {
  const snap = await collection().where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => toPublicApiKey(doc.data() as ApiKeyDocument))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/** Revoke a key by its public id. Returns false if not found/already revoked. */
export async function revokeApiKey(
  orgId: string,
  keyId: string,
): Promise<boolean> {
  const snap = await collection().where('orgId', '==', orgId).get()
  const match = snap.docs.find(
    (doc) => (doc.data() as ApiKeyDocument).keyId === keyId,
  )
  if (!match || (match.data() as ApiKeyDocument).revokedAt) return false
  await match.ref.update({
    revokedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
  return true
}
