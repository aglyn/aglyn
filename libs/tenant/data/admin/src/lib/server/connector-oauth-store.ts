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
 * CONNECTOR SIGN-IN, THE STORE (AGL-4225).
 *
 * Five Admin-SDK-only collections, deny-all in the rules:
 *
 *  - `oauthClients/{clientId}` — a registration: name, redirect addresses,
 *    and an `expiresAt` that every use pushes on. Unused ones lapse.
 *  - `oauthCodes/{sha256}` — one approval, waiting to be exchanged. Bound to
 *    the client, the address, the PKCE challenge, the workspace, the person
 *    and the access chosen. Single use; a second use revokes what the first
 *    produced.
 *  - `oauthGrants/{grantId}` — a CONNECTION: one app, one workspace, one
 *    person. What Settings lists and Disconnect revokes, and the identity a
 *    connector's calls are rate limited and attributed under.
 *  - `oauthRefreshTokens/{sha256}` — rotated on every use; an old one that
 *    comes back revokes the connection.
 *  - `oauthAccessTokens/{sha256}` — one hour each.
 *
 * Every `expiresAt` is a Firestore Timestamp and carries a TTL policy, and
 * every reader checks it too: TTL deletion is a background sweep that can lag
 * by a day, so it is housekeeping and never the check.
 *
 * A CONNECTION IS LIVE only while its person still belongs to the workspace
 * with the "Manage API keys" permission (`org.apiKeys`) — the permission it
 * took to connect — and the connection is not revoked. That is checked on
 * EVERY call (`verifyConnectorAccessToken`), not only at refresh: a removed
 * member's app stops on its next call rather than an hour later. A
 * connection found dead that way is revoked, so Settings stops listing it.
 * Workspace lockdown and the plan check run per call in `authenticateApiV1`,
 * the same chokepoint API keys go through; a full lock also refuses a
 * refresh and revokes the connection.
 */
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiKeyGrant, type ApiScope, normalizeScopes } from './api-keys'
import {
  accessLevelOf,
  CONNECTOR_ACCESS_TOKEN_TTL_MS,
  CONNECTOR_ACCESS_TOKENS_COLLECTION,
  CONNECTOR_CLIENT_IDLE_TTL_MS,
  CONNECTOR_CLIENTS_COLLECTION,
  CONNECTOR_CODE_TTL_MS,
  CONNECTOR_CODES_COLLECTION,
  CONNECTOR_GRANTS_COLLECTION,
  CONNECTOR_REFRESH_TOKEN_TTL_MS,
  CONNECTOR_REFRESH_TOKENS_COLLECTION,
  type ConnectorAccessLevel,
  describeRedirectTarget,
  generateConnectorAccessToken,
  generateConnectorClientId,
  generateConnectorCode,
  generateConnectorGrantId,
  generateConnectorRefreshToken,
  hashConnectorSecret,
  isConnectorAccessTokenFormat,
  isConnectorClientIdFormat,
  isConnectorCodeFormat,
  isConnectorGrantIdFormat,
  isConnectorRefreshTokenFormat,
  type RegisteredConnectorClient,
  verifyPkceS256,
} from './connector-oauth'
import { firebaseAdmin } from './firebase-admin'
import { getLockdownVerdict } from './lockdown'
import { memberHasOrgPermission, resolveOrgMembership } from './organizations'

function db(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

const at = (ms: number) => Timestamp.fromMillis(ms)
const msOf = (value: unknown): number =>
  value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : 0
const isoOf = (value: unknown): string | null => {
  const ms = msOf(value)
  return ms ? new Date(ms).toISOString() : null
}

/** How often `lastUsedAt` may be written for one connection, at most. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000
/** How often a client's idle clock may be pushed on, at most. */
const CLIENT_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000

// ── Liveness ────────────────────────────────────────────────────────────────

/** Why a connection may not be used, or `live`. */
export type ConnectorLiveness = 'live' | 'not_member' | 'no_permission' | 'locked' | 'plan'

export interface ConnectorLivenessOptions {
  /** Also refuse a workspace that a full lock covers for this person. */
  lockdown?: boolean
  /** Also refuse a workspace whose plan lacks API access. */
  entitlement?: boolean
}

/**
 * May `uid` still act for `orgId` through a connector?
 *
 * The same standard the API keys route holds a key MANAGER to: an org-wide
 * member (a site collaborator's reach is a list of sites, and a connector
 * reads org-wide) holding `org.apiKeys`. No staff bypass — a connection acts
 * as a person, and staff are not that person.
 */
export async function checkConnectorLiveness(
  orgId: string,
  uid: string,
  options: ConnectorLivenessOptions = {},
): Promise<ConnectorLiveness> {
  const membership = await resolveOrgMembership(uid, orgId)
  if (!membership || !isOrgWideMember(membership.member)) return 'not_member'
  if (!(await memberHasOrgPermission(orgId, membership.member, 'org.apiKeys'))) {
    return 'no_permission'
  }
  if (options.lockdown || options.entitlement) {
    const org = (await db().collection('orgs').doc(orgId).get()).data()
    if (!org) return 'not_member'
    if (options.lockdown && (await getLockdownVerdict({ uid, org, intent: 'read' }))) {
      return 'locked'
    }
    if (options.entitlement && !checkEntitlement(org, 'apiAccess')) return 'plan'
  }
  return 'live'
}

/** Injected by tests; the real check otherwise. */
export type LivenessCheck = typeof checkConnectorLiveness

// ── Clients ─────────────────────────────────────────────────────────────────

export interface ConnectorClientRegistration {
  clientId: string
  clientName: string
  redirectUris: string[]
  issuedAtMs: number
}

/** Store a validated registration. The caller has run `validateClientRegistration`. */
export async function registerConnectorClient(
  input: { clientName: string; redirectUris: string[] },
  now = Date.now(),
): Promise<ConnectorClientRegistration> {
  const clientId = generateConnectorClientId()
  await db()
    .collection(CONNECTOR_CLIENTS_COLLECTION)
    .doc(clientId)
    .create({
      clientId,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      createdAt: at(now),
      lastUsedAt: at(now),
      expiresAt: at(now + CONNECTOR_CLIENT_IDLE_TTL_MS),
    })
  return { clientId, clientName: input.clientName, redirectUris: input.redirectUris, issuedAtMs: now }
}

/** A live registration, or `null` when it is unknown or has lapsed. */
export async function readConnectorClient(
  clientId: unknown,
  now = Date.now(),
): Promise<RegisteredConnectorClient | null> {
  if (!isConnectorClientIdFormat(clientId)) return null
  const snap = await db().collection(CONNECTOR_CLIENTS_COLLECTION).doc(clientId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  if (msOf(data.expiresAt) <= now) return null
  return {
    clientId,
    clientName: String(data.clientName ?? ''),
    redirectUris: Array.isArray(data.redirectUris) ? data.redirectUris.map(String) : [],
  }
}

/** Push a client's idle clock on. At most once a day; never fails the caller. */
async function touchConnectorClient(clientId: string, now: number): Promise<void> {
  try {
    const ref = db().collection(CONNECTOR_CLIENTS_COLLECTION).doc(clientId)
    const snap = await ref.get()
    if (!snap.exists) return
    if (now - msOf(snap.data()?.lastUsedAt) < CLIENT_TOUCH_INTERVAL_MS) return
    await ref.update({ lastUsedAt: at(now), expiresAt: at(now + CONNECTOR_CLIENT_IDLE_TTL_MS) })
  } catch {
    // Housekeeping only: a missed touch costs at most a later re-registration.
  }
}

// ── Codes ───────────────────────────────────────────────────────────────────

export interface MintCodeInput {
  clientId: string
  redirectUri: string
  codeChallenge: string
  orgId: string
  uid: string
  /** The approver's address, shown in Settings as who connected the app. */
  email: string | null
  scopes: readonly ApiScope[]
  resource: string | null
}

/** Record an approval and return the one-time code that redeems it. */
export async function mintConnectorCode(input: MintCodeInput, now = Date.now()): Promise<string> {
  const scopes = normalizeScopes(input.scopes)
  if (!scopes.length) throw new Error('A connection needs at least one scope')
  const code = generateConnectorCode()
  await db()
    .collection(CONNECTOR_CODES_COLLECTION)
    .doc(hashConnectorSecret(code))
    .create({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      orgId: input.orgId,
      uid: input.uid,
      email: input.email ?? null,
      scopes,
      resource: input.resource,
      createdAt: at(now),
      expiresAt: at(now + CONNECTOR_CODE_TTL_MS),
      usedAt: null,
      grantId: null,
    })
  touchConnectorClient(input.clientId, now).catch(() => undefined)
  return code
}

// ── Token responses ─────────────────────────────────────────────────────────

/** RFC 6749 §5.1, as the token endpoint returns it. */
export interface ConnectorTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export type ConnectorTokenResult =
  | {
      ok: true
      tokens: ConnectorTokenResponse
      /** For the activity log: set only when the exchange created a connection. */
      connected?: { grantId: string; orgId: string; uid: string; email: string | null; clientName: string }
    }
  | { ok: false; error: 'invalid_grant' | 'invalid_scope' | 'invalid_target'; description: string }

const invalidGrant = (description: string): ConnectorTokenResult => ({
  ok: false,
  error: 'invalid_grant',
  description,
})

/** Write the access and refresh token documents for `grant` inside `tx`. */
function issueTokens(
  tx: FirebaseFirestore.Transaction,
  grant: { grantId: string; orgId: string; uid: string; clientId: string; scopes: ApiScope[] },
  now: number,
): ConnectorTokenResponse {
  const store = db()
  const accessToken = generateConnectorAccessToken()
  const refreshToken = generateConnectorRefreshToken()
  tx.create(store.collection(CONNECTOR_ACCESS_TOKENS_COLLECTION).doc(hashConnectorSecret(accessToken)), {
    grantId: grant.grantId,
    orgId: grant.orgId,
    uid: grant.uid,
    clientId: grant.clientId,
    scopes: grant.scopes,
    createdAt: at(now),
    expiresAt: at(now + CONNECTOR_ACCESS_TOKEN_TTL_MS),
  })
  tx.create(store.collection(CONNECTOR_REFRESH_TOKENS_COLLECTION).doc(hashConnectorSecret(refreshToken)), {
    grantId: grant.grantId,
    orgId: grant.orgId,
    uid: grant.uid,
    clientId: grant.clientId,
    createdAt: at(now),
    expiresAt: at(now + CONNECTOR_REFRESH_TOKEN_TTL_MS),
    rotatedAt: null,
  })
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(CONNECTOR_ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: grant.scopes.join(' '),
  }
}

// ── Revocation ──────────────────────────────────────────────────────────────

/** Why a connection ended. Stored on it; never shown with any secret. */
export type ConnectorRevokeReason =
  | 'disconnected'
  | 'client_revoked'
  | 'code_replayed'
  | 'refresh_replayed'
  | 'replaced'
  | ConnectorLiveness

/**
 * End a connection. Every token it issued dies with it, because every token
 * check reads the connection. Idempotent: an ended connection stays ended
 * with its first reason. `expiresAt` moves to now so the TTL sweep clears it.
 */
export async function revokeConnectorGrant(
  grantId: string,
  reason: ConnectorRevokeReason,
  now = Date.now(),
): Promise<boolean> {
  if (!isConnectorGrantIdFormat(grantId)) return false
  const ref = db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()?.revokedAt) return false
    tx.update(ref, { revokedAt: at(now), revokedReason: reason, expiresAt: at(now) })
    return true
  })
}

// ── Exchange ────────────────────────────────────────────────────────────────

export interface ExchangeCodeInput {
  code: unknown
  clientId: unknown
  redirectUri: unknown
  codeVerifier: unknown
  /** RFC 8707 `resource`, when the client sent one. Must match the code's. */
  resource?: unknown
}

/**
 * Trade a code for the first credentials, creating the connection.
 *
 * The code is checked twice. A first read outside any transaction finds the
 * workspace and person so liveness — membership, permission, lock, plan —
 * can be asked (those reads are not this transaction's to hold). Then ONE
 * transaction re-reads the code, refuses it if anything changed, marks it
 * used, and creates the connection and both tokens together: two concurrent
 * exchanges cannot both commit, and nothing is ever half-issued.
 *
 * A code presented after it was used is not just refused: the connection it
 * produced is revoked (RFC 6749 §4.1.2). Whoever holds the code now is not
 * who should, and the safe answer is that neither keeps access.
 *
 * Bindings that do not match (client, address, verifier) refuse WITHOUT
 * spending the code, so a third party that learns a code cannot burn it out
 * from under the client it was issued to.
 */
export async function exchangeConnectorCode(
  input: ExchangeCodeInput,
  options: { now?: number; liveness?: LivenessCheck } = {},
): Promise<ConnectorTokenResult> {
  const now = options.now ?? Date.now()
  const liveness = options.liveness ?? checkConnectorLiveness
  if (!isConnectorCodeFormat(input.code)) return invalidGrant('The code is not valid')
  const ref = db().collection(CONNECTOR_CODES_COLLECTION).doc(hashConnectorSecret(input.code))

  const bindingsHold = (data: FirebaseFirestore.DocumentData): string | null => {
    if (input.clientId !== data.clientId) return 'The code was issued to another client'
    if (typeof input.redirectUri !== 'string' || input.redirectUri !== data.redirectUri) {
      return 'redirect_uri does not match the one the code was issued for'
    }
    if (!verifyPkceS256(input.codeVerifier, data.codeChallenge)) {
      return 'code_verifier does not match the code_challenge'
    }
    // The route has already held a sent `resource` to this server's MCP
    // endpoint; here it must also agree with the one the approval named.
    if (
      typeof input.resource === 'string' &&
      input.resource &&
      typeof data.resource === 'string' &&
      input.resource !== data.resource
    ) {
      return 'resource does not match the authorization request'
    }
    return null
  }

  const first = await ref.get()
  if (!first.exists) return invalidGrant('The code is not valid')
  const preview = first.data() ?? {}
  if (preview.usedAt) {
    if (typeof preview.grantId === 'string') {
      await revokeConnectorGrant(preview.grantId, 'code_replayed', now).catch(() => undefined)
    }
    return invalidGrant('The code has already been used')
  }
  if (msOf(preview.expiresAt) <= now) return invalidGrant('The code has expired')
  const mismatch = bindingsHold(preview)
  if (mismatch) return invalidGrant(mismatch)

  const orgId = String(preview.orgId ?? '')
  const uid = String(preview.uid ?? '')
  const verdict = await liveness(orgId, uid, { lockdown: true, entitlement: true })
  if (verdict !== 'live') return invalidGrant('The approval is no longer valid')

  const client = await readConnectorClient(preview.clientId, now)
  if (!client) return invalidGrant('The client is no longer registered')

  const grantId = generateConnectorGrantId()
  type Outcome =
    | { kind: 'issued'; tokens: ConnectorTokenResponse; scopes: ApiScope[]; email: string | null }
    | { kind: 'replayed'; grantId: string | null }
    | { kind: 'refused'; description: string }
  const outcome: Outcome = await db().runTransaction(async (tx): Promise<Outcome> => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { kind: 'refused', description: 'The code is not valid' }
    const data = snap.data() ?? {}
    if (data.usedAt) {
      return { kind: 'replayed', grantId: typeof data.grantId === 'string' ? data.grantId : null }
    }
    if (msOf(data.expiresAt) <= now) return { kind: 'refused', description: 'The code has expired' }
    const changed = bindingsHold(data)
    if (changed) return { kind: 'refused', description: changed }

    const scopes = normalizeScopes(Array.isArray(data.scopes) ? data.scopes.map(String) : [])
    if (!scopes.length) return { kind: 'refused', description: 'The approval grants nothing' }
    const email = typeof data.email === 'string' ? data.email : null
    tx.update(ref, { usedAt: at(now), grantId })
    tx.create(db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId), {
      grantId,
      orgId,
      uid,
      connectedByEmail: email,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectHost: describeRedirectTarget(String(data.redirectUri)).host,
      scopes,
      createdAt: at(now),
      lastUsedAt: at(now),
      revokedAt: null,
      revokedReason: null,
      expiresAt: at(now + CONNECTOR_REFRESH_TOKEN_TTL_MS),
    })
    const tokens = issueTokens(tx, { grantId, orgId, uid, clientId: client.clientId, scopes }, now)
    return { kind: 'issued', tokens, scopes, email }
  })

  if (outcome.kind === 'replayed') {
    if (outcome.grantId) {
      await revokeConnectorGrant(outcome.grantId, 'code_replayed', now).catch(() => undefined)
    }
    return invalidGrant('The code has already been used')
  }
  if (outcome.kind === 'refused') return invalidGrant(outcome.description)

  await replaceEarlierConnections({ grantId, clientId: client.clientId, orgId, uid }, now)
  touchConnectorClient(client.clientId, now).catch(() => undefined)
  return {
    ok: true,
    tokens: outcome.tokens,
    connected: { grantId, orgId, uid, email: outcome.email, clientName: client.clientName },
  }
}

/**
 * A client that connects the same person to the same workspace again is
 * replacing its credentials, not adding a second set: the earlier connection
 * is ended, so Settings shows one row per app and an abandoned refresh token
 * cannot be revived. A different app, workspace or person is untouched.
 */
async function replaceEarlierConnections(
  current: { grantId: string; clientId: string; orgId: string; uid: string },
  now: number,
): Promise<void> {
  try {
    const snap = await db()
      .collection(CONNECTOR_GRANTS_COLLECTION)
      .where('clientId', '==', current.clientId)
      .where('uid', '==', current.uid)
      .get()
    for (const doc of snap.docs) {
      const data = doc.data()
      if (doc.id === current.grantId || data.orgId !== current.orgId || data.revokedAt) continue
      await revokeConnectorGrant(doc.id, 'replaced', now)
    }
  } catch {
    // The new connection is already valid; an old row left listed is cosmetic
    // and still dies on its own refresh-token expiry.
  }
}

// ── Refresh ─────────────────────────────────────────────────────────────────

export interface RefreshInput {
  refreshToken: unknown
  clientId: unknown
  /** Optional narrowing, space-separated. Never a widening. */
  scope?: unknown
}

/**
 * Rotate a refresh token: the presented one is spent and a new pair issued.
 *
 * A refresh token presented AFTER it was rotated is evidence that two
 * parties hold it, and the connection is revoked — the legitimate client
 * re-connects, the other loses everything (OAuth 2.1 §4.3.1). That includes
 * a client that retries a refresh whose answer it lost; the cost is one
 * re-connect, and the alternative is a window in which a stolen token works.
 *
 * Liveness is asked here with the lock check on, so a fully locked workspace
 * or a removed member ends the connection at the latest at the next refresh,
 * whether or not a call was made in between.
 */
export async function refreshConnectorTokens(
  input: RefreshInput,
  options: { now?: number; liveness?: LivenessCheck } = {},
): Promise<ConnectorTokenResult> {
  const now = options.now ?? Date.now()
  const liveness = options.liveness ?? checkConnectorLiveness
  if (!isConnectorRefreshTokenFormat(input.refreshToken)) {
    return invalidGrant('The refresh token is not valid')
  }
  const ref = db()
    .collection(CONNECTOR_REFRESH_TOKENS_COLLECTION)
    .doc(hashConnectorSecret(input.refreshToken))

  const first = await ref.get()
  if (!first.exists) return invalidGrant('The refresh token is not valid')
  const preview = first.data() ?? {}
  if (input.clientId !== preview.clientId) return invalidGrant('The refresh token was issued to another client')
  const grantId = String(preview.grantId ?? '')
  if (preview.rotatedAt) {
    await revokeConnectorGrant(grantId, 'refresh_replayed', now).catch(() => undefined)
    return invalidGrant('The refresh token has already been used')
  }
  if (msOf(preview.expiresAt) <= now) return invalidGrant('The refresh token has expired')

  const verdict = await liveness(String(preview.orgId ?? ''), String(preview.uid ?? ''), {
    lockdown: true,
  })
  if (verdict !== 'live') {
    await revokeConnectorGrant(grantId, verdict, now).catch(() => undefined)
    return invalidGrant('The connection is no longer valid')
  }

  const grantRef = db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId)
  type Outcome =
    | { kind: 'issued'; tokens: ConnectorTokenResponse }
    | { kind: 'replayed' }
    | { kind: 'refused'; error: 'invalid_grant' | 'invalid_scope'; description: string }
  const outcome: Outcome = await db().runTransaction(async (tx): Promise<Outcome> => {
    const [snap, grantSnap] = await Promise.all([tx.get(ref), tx.get(grantRef)])
    if (!snap.exists) return { kind: 'refused', error: 'invalid_grant', description: 'The refresh token is not valid' }
    const data = snap.data() ?? {}
    if (data.rotatedAt) return { kind: 'replayed' }
    if (msOf(data.expiresAt) <= now) {
      return { kind: 'refused', error: 'invalid_grant', description: 'The refresh token has expired' }
    }
    const grant = grantSnap.data()
    if (!grantSnap.exists || !grant || grant.revokedAt) {
      return { kind: 'refused', error: 'invalid_grant', description: 'The connection has ended' }
    }
    const granted = normalizeScopes(Array.isArray(grant.scopes) ? grant.scopes.map(String) : [])
    let scopes = granted
    if (typeof input.scope === 'string' && input.scope.trim()) {
      const asked = input.scope.split(' ').filter(Boolean)
      if (asked.some((scope) => !granted.includes(scope as ApiScope))) {
        return { kind: 'refused', error: 'invalid_scope', description: 'scope may only narrow the connection' }
      }
      scopes = normalizeScopes(asked)
    }
    if (!scopes.length) return { kind: 'refused', error: 'invalid_grant', description: 'The connection grants nothing' }

    tx.update(ref, { rotatedAt: at(now) })
    tx.update(grantRef, { lastUsedAt: at(now), expiresAt: at(now + CONNECTOR_REFRESH_TOKEN_TTL_MS) })
    const tokens = issueTokens(
      tx,
      { grantId, orgId: String(grant.orgId), uid: String(grant.uid), clientId: String(grant.clientId), scopes },
      now,
    )
    return { kind: 'issued', tokens }
  })

  if (outcome.kind === 'replayed') {
    await revokeConnectorGrant(grantId, 'refresh_replayed', now).catch(() => undefined)
    return invalidGrant('The refresh token has already been used')
  }
  if (outcome.kind === 'refused') {
    return { ok: false, error: outcome.error, description: outcome.description }
  }
  touchConnectorClient(String(preview.clientId), now).catch(() => undefined)
  return { ok: true, tokens: outcome.tokens }
}

// ── Revocation endpoint (RFC 7009) ──────────────────────────────────────────

/**
 * Revoke whatever `token` is, if it belongs to `clientId`.
 *
 * A refresh token ends the whole connection — it is the long-lived half, and
 * a client revoking it is disconnecting. An access token ends only itself.
 * Anything unknown, malformed or another client's is ignored: RFC 7009 §2.2
 * answers 200 either way, so this never tells a caller what exists.
 */
export async function revokeConnectorToken(
  input: { token: unknown; clientId: unknown },
  now = Date.now(),
): Promise<void> {
  const { token, clientId } = input
  if (isConnectorRefreshTokenFormat(token)) {
    const snap = await db()
      .collection(CONNECTOR_REFRESH_TOKENS_COLLECTION)
      .doc(hashConnectorSecret(token))
      .get()
    const data = snap.data()
    if (snap.exists && data && data.clientId === clientId) {
      await revokeConnectorGrant(String(data.grantId), 'client_revoked', now)
    }
    return
  }
  if (isConnectorAccessTokenFormat(token)) {
    const ref = db().collection(CONNECTOR_ACCESS_TOKENS_COLLECTION).doc(hashConnectorSecret(token))
    const snap = await ref.get()
    if (snap.exists && snap.data()?.clientId === clientId) await ref.delete()
  }
}

// ── Verification (the `/api/v1` door) ───────────────────────────────────────

/** What a connector's access token resolves to — a key's shape plus the person. */
export interface VerifiedConnectorToken {
  orgId: string
  /** The connection id, so rate limits and attribution follow the connection. */
  keyId: string
  scopes: ApiScope[]
  /** The app's name, e.g. "Claude" — what its writes are attributed to. */
  name: string
  /** The person who connected it; the user-scope lockdown applies to them. */
  uid: string
}

/**
 * Resolve an access token, or `null` when it is malformed, unknown, expired,
 * or its connection has ended or is no longer live.
 *
 * Reads the token, then the connection, then asks liveness: a Disconnect,
 * a removed member or a revoked permission takes effect on the next call.
 * A liveness answer of "no" revokes the connection; a READ that fails does
 * not — it answers `null` for this call and leaves the connection alone,
 * because a Firestore blip is not evidence about the person.
 */
export async function verifyConnectorAccessToken(
  token: string,
  options: { now?: number; liveness?: LivenessCheck } = {},
): Promise<VerifiedConnectorToken | null> {
  const now = options.now ?? Date.now()
  const liveness = options.liveness ?? checkConnectorLiveness
  if (!isConnectorAccessTokenFormat(token)) return null
  try {
    const snap = await db()
      .collection(CONNECTOR_ACCESS_TOKENS_COLLECTION)
      .doc(hashConnectorSecret(token))
      .get()
    if (!snap.exists) return null
    const data = snap.data() ?? {}
    if (msOf(data.expiresAt) <= now) return null
    const grantId = String(data.grantId ?? '')
    if (!isConnectorGrantIdFormat(grantId)) return null
    const grantRef = db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId)
    const grantSnap = await grantRef.get()
    const grant = grantSnap.data()
    if (!grantSnap.exists || !grant || grant.revokedAt) return null
    if (grant.orgId !== data.orgId || grant.uid !== data.uid) return null

    const verdict = await liveness(String(grant.orgId), String(grant.uid))
    if (verdict !== 'live') {
      // Awaited: only a refusal pays for it, and Settings should stop
      // listing the connection by the time this caller hears 401.
      await revokeConnectorGrant(grantId, verdict, now).catch(() => undefined)
      return null
    }

    if (now - msOf(grant.lastUsedAt) > LAST_USED_WRITE_INTERVAL_MS) {
      grantRef.update({ lastUsedAt: at(now) }).catch(() => undefined)
    }
    const granted = normalizeScopes(Array.isArray(grant.scopes) ? grant.scopes.map(String) : [])
    const tokenScopes = Array.isArray(data.scopes) ? data.scopes.map(String) : []
    return {
      orgId: String(grant.orgId),
      keyId: grantId,
      scopes: granted.filter((scope) => tokenScopes.includes(scope)),
      name: String(grant.clientName ?? ''),
      uid: String(grant.uid),
    }
  } catch {
    return null
  }
}

// ── Settings: Connected apps ────────────────────────────────────────────────

/** A connection as Settings lists it. No hash, no secret, no client id. */
export interface PublicConnectorGrant {
  grantId: string
  appName: string
  /** The host the app received its code at, e.g. `claude.ai` or `localhost`. */
  returnsTo: string
  connectedBy: string | null
  connectedAt: string | null
  lastUsedAt: string | null
  access: ConnectorAccessLevel
}

/** The workspace's live connections, newest first. */
export async function listConnectorGrants(orgId: string, now = Date.now()): Promise<PublicConnectorGrant[]> {
  if (!orgId) return []
  const snap = await db().collection(CONNECTOR_GRANTS_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => doc.data())
    .filter((data) => !data.revokedAt && msOf(data.expiresAt) > now)
    .sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt))
    .map((data) => ({
      grantId: String(data.grantId),
      appName: String(data.clientName ?? ''),
      returnsTo: String(data.redirectHost ?? ''),
      connectedBy: typeof data.connectedByEmail === 'string' ? data.connectedByEmail : null,
      connectedAt: isoOf(data.createdAt),
      lastUsedAt: isoOf(data.lastUsedAt),
      access: accessLevelOf(Array.isArray(data.scopes) ? data.scopes.map(String) : []),
    }))
}

/**
 * Disconnect one of the workspace's connections. `false` when it is not this
 * workspace's or has already ended — a connection id from another workspace
 * is indistinguishable from an unknown one.
 */
export async function disconnectConnectorGrant(
  orgId: string,
  grantId: unknown,
  now = Date.now(),
): Promise<{ disconnected: boolean; appName: string | null }> {
  if (!orgId || !isConnectorGrantIdFormat(grantId)) return { disconnected: false, appName: null }
  const snap = await db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId).get()
  const data = snap.data()
  if (!snap.exists || !data || data.orgId !== orgId || data.revokedAt) {
    return { disconnected: false, appName: null }
  }
  const disconnected = await revokeConnectorGrant(grantId, 'disconnected', now)
  return { disconnected, appName: String(data.clientName ?? '') }
}

/**
 * A connection read the way `readApiKeyGrant` reads a key, for something the
 * connection SET UP that acts on its behalf later — a REST hook it
 * subscribed. `null` once the connection has ended or is no longer live, so
 * nothing it set up outlives it.
 */
export async function readConnectorGrantAsKey(
  orgId: string,
  grantId: string,
  options: { now?: number; liveness?: LivenessCheck } = {},
): Promise<ApiKeyGrant | null> {
  const now = options.now ?? Date.now()
  const liveness = options.liveness ?? checkConnectorLiveness
  if (!orgId || !isConnectorGrantIdFormat(grantId)) return null
  const snap = await db().collection(CONNECTOR_GRANTS_COLLECTION).doc(grantId).get()
  const data = snap.data()
  if (!snap.exists || !data || data.orgId !== orgId || data.revokedAt) return null
  if (msOf(data.expiresAt) <= now) return null
  if ((await liveness(orgId, String(data.uid ?? ''))) !== 'live') return null
  return {
    keyId: grantId,
    name: String(data.clientName ?? ''),
    scopes: normalizeScopes(Array.isArray(data.scopes) ? data.scopes.map(String) : []),
  }
}

/** True when `keyId` names a connection rather than an API key. */
export function isConnectorKeyId(keyId: string): boolean {
  return isConnectorGrantIdFormat(keyId)
}

/** For erasure: every connector document naming `orgId`, by collection. */
export const CONNECTOR_ORG_KEYED_COLLECTIONS = [
  CONNECTOR_GRANTS_COLLECTION,
  CONNECTOR_CODES_COLLECTION,
  CONNECTOR_ACCESS_TOKENS_COLLECTION,
  CONNECTOR_REFRESH_TOKENS_COLLECTION,
] as const
