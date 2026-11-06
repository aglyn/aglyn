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
 * A SITE'S DECLARED CONNECTION, AND ITS SEALED GRANT (AGL-4193).
 *
 * `hosts/{hostId}/pluginConnections/{listingId}__{connectionId}` — one per
 * site, listing and declared connection. Copied in shape from accounting's
 * ledger connection (`libs/plugins/accounting/.../connection-store.ts`), not
 * imported: one plugin never imports another.
 *
 * The refresh and access tokens are sealed with `PLUGIN_CONNECTIONS_TOKEN_KEY`
 * (secret box, AES-256-GCM), each bound to this document and its purpose as
 * the seal's context, so a value copied onto another site's document refuses
 * to open there. The rules refuse every client the whole collection; the
 * console reads {@link toConnectionView}, which carries no token, through the
 * status route.
 *
 * ## Rotation, and only one refresher
 *
 * Many providers hand back a new refresh token on a refresh and retire the
 * old one soon after. Two processes refreshing the same grant at once — the
 * picker and the scheduled sync — would each spend the old token, and one
 * would store a token the provider has already replaced. So a refresh first
 * takes a short LEASE on the document in a transaction; a second refresher
 * that finds the lease held waits for the first's result instead. A provider
 * that refuses the grant (`invalid_grant`, a 401) moves the connection to
 * `reconnect_required`, which only the site owner connecting again clears.
 */

import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import type { PluginConnectionDeclaration } from '@aglyn/aglyn/app-utils/plugin-connections'
import {
  pluginConnectionDocId,
  pluginConnectionRecordDocId,
  type PluginConnectionChoice,
  type PluginConnectionStatus,
  type PluginConnectionView,
} from '../../model/plugin-connections'
import {
  PluginConnectionProviderError,
  refreshPluginConnectionToken,
  type PluginConnectionClient,
  type PluginConnectionTokenSet,
} from './provider-http'

/** The stored document. Server-only. */
export interface PluginConnectionRecord {
  /** Tells a connection from a pending connect's state record in the same collection. */
  kind: 'connection'
  hostId: string
  /** The workspace that owns the site, when it connected. */
  orgId: string
  listingId: string
  connectionId: string
  provider: string
  status: PluginConnectionStatus
  /** `''` when the provider issued no refresh token. */
  sealedRefreshToken: string
  sealedAccessToken: string
  accessExpiresAtMs: number
  refreshedAtMs: number
  refreshLeaseUntilMs: number
  scopes: string[]
  /** What the owner chose, by resource id. */
  choices: Record<string, PluginConnectionChoice>
  connectedAtMs: number
  connectedByUid: string
  lastSyncAtMs: number | null
  /** When the scheduled sync should next run this connection; `null` while it waits for choices. */
  nextSyncAtMs: number | null
  lastError: string | null
  /** Scheduled syncs that failed in a row since the last one that ran; sets the backoff (AGL-4194). */
  syncFailures?: number
  updatedAtMs: number
}

export function connectionsCollection(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): FirebaseFirestore.CollectionReference {
  // Spelled out, not `PLUGIN_CONNECTIONS_HOST_COLLECTION`: the repo's host
  // collection guards find a site's collections by this literal shape.
  return firestore.collection('hosts').doc(hostId).collection('pluginConnections')
}

export function connectionRef(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  listingId: string,
  connectionId: string,
): FirebaseFirestore.DocumentReference {
  return connectionsCollection(firestore, hostId).doc(pluginConnectionDocId(listingId, connectionId))
}

/** The record the connection's sync writes, beside it (AGL-4192, AGL-4194). Server-only, like the rest. */
export function connectionRecordRef(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  listingId: string,
  connectionId: string,
): FirebaseFirestore.DocumentReference {
  return connectionsCollection(firestore, hostId).doc(pluginConnectionRecordDocId(listingId, connectionId))
}

type TokenOwner = Pick<PluginConnectionRecord, 'hostId' | 'listingId' | 'connectionId'>

/** The seal's context: this document and this token's purpose. */
export const tokenContext = (owner: TokenOwner, purpose: 'refresh' | 'access') =>
  `plugin-connections:token:${owner.hostId}:${owner.listingId}:${owner.connectionId}:${purpose}`

/** Seals a token set for a record; a missing refresh token keeps `previousRefresh` (already sealed). */
export function sealTokens(
  keyring: SecretBoxKeyring,
  owner: TokenOwner,
  tokens: Pick<PluginConnectionTokenSet, 'accessToken' | 'refreshToken'>,
  previousRefresh = '',
): Pick<PluginConnectionRecord, 'sealedRefreshToken' | 'sealedAccessToken'> {
  return {
    sealedRefreshToken: tokens.refreshToken
      ? sealSecret(tokens.refreshToken, keyring.current, { context: tokenContext(owner, 'refresh') })
      : previousRefresh,
    sealedAccessToken: sealSecret(tokens.accessToken, keyring.current, { context: tokenContext(owner, 'access') }),
  }
}

/** Opens one of a record's tokens; throws `SecretBoxError` for one that does not open. */
export function openToken(
  keyring: SecretBoxKeyring,
  record: TokenOwner & Pick<PluginConnectionRecord, 'sealedRefreshToken' | 'sealedAccessToken'>,
  purpose: 'refresh' | 'access',
): { token: string; reseal: boolean } {
  const sealed = purpose === 'refresh' ? record.sealedRefreshToken : record.sealedAccessToken
  const opened = openSecret(sealed, keyring, { context: tokenContext(record, purpose) })
  return { token: opened.plaintext, reseal: needsReseal(opened, keyring) }
}

const STATUSES: readonly PluginConnectionStatus[] = ['connected', 'reconnect_required', 'error']

/** A stored document read defensively, or `null` for anything that is not a connection. */
export function readConnection(data: Record<string, unknown> | undefined): PluginConnectionRecord | null {
  if (!data || data['kind'] !== 'connection' || typeof data['listingId'] !== 'string' || typeof data['connectionId'] !== 'string') {
    return null
  }
  const record = data as unknown as PluginConnectionRecord
  const choices: Record<string, PluginConnectionChoice> = {}
  if (record.choices && typeof record.choices === 'object') {
    for (const [key, value] of Object.entries(record.choices)) {
      if (value && typeof value.id === 'string') choices[key] = { id: value.id, label: String(value.label ?? value.id) }
    }
  }
  return {
    ...record,
    status: STATUSES.includes(record.status) ? record.status : 'error',
    sealedRefreshToken: typeof record.sealedRefreshToken === 'string' ? record.sealedRefreshToken : '',
    sealedAccessToken: typeof record.sealedAccessToken === 'string' ? record.sealedAccessToken : '',
    accessExpiresAtMs: Number(record.accessExpiresAtMs) || 0,
    refreshedAtMs: Number(record.refreshedAtMs) || 0,
    refreshLeaseUntilMs: Number(record.refreshLeaseUntilMs) || 0,
    scopes: Array.isArray(record.scopes) ? record.scopes.map(String) : [],
    choices,
    lastSyncAtMs: Number(record.lastSyncAtMs) || null,
    nextSyncAtMs: Number(record.nextSyncAtMs) || null,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
    syncFailures: Math.max(0, Math.trunc(Number(record.syncFailures) || 0)),
  }
}

export async function getConnection(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  listingId: string,
  connectionId: string,
): Promise<PluginConnectionRecord | null> {
  const snapshot = await connectionRef(firestore, hostId, listingId, connectionId).get()
  return snapshot.exists ? readConnection(snapshot.data()) : null
}

/** Every connection a site holds (never the pending states). */
export async function listHostConnections(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<PluginConnectionRecord[]> {
  const snapshot = await connectionsCollection(firestore, hostId).where('kind', '==', 'connection').get()
  return snapshot.docs
    .map((doc) => readConnection(doc.data()))
    .filter((record): record is PluginConnectionRecord => Boolean(record))
}

/** Whether every resource the declaration lists has a choice. */
export function connectionReady(
  record: Pick<PluginConnectionRecord, 'choices'>,
  declaration: Pick<PluginConnectionDeclaration, 'resources'> | null,
): boolean {
  return (declaration?.resources ?? []).every((resource) => Boolean(record.choices[resource.id]))
}

/** What the console reads: no token, no lease, no uid. */
export function toConnectionView(
  record: PluginConnectionRecord,
  declaration: Pick<PluginConnectionDeclaration, 'resources'> | null,
): PluginConnectionView {
  return {
    listingId: record.listingId,
    connectionId: record.connectionId,
    provider: record.provider,
    status: record.status,
    choices: record.choices,
    ready: connectionReady(record, declaration),
    scopes: record.scopes,
    connectedAtMs: record.connectedAtMs,
    lastSyncAtMs: record.lastSyncAtMs,
    lastError: record.lastError,
  }
}

/**
 * Builds the record for a freshly exchanged grant. Reconnecting keeps the
 * earlier choices and sync history: the owner reconnecting after a revoked
 * grant means the same account, and the choose route re-checks every choice
 * against what the new grant reaches before it is used again.
 */
export function newConnectionRecord(input: {
  keyring: SecretBoxKeyring
  hostId: string
  orgId: string
  listingId: string
  connection: PluginConnectionDeclaration
  tokens: PluginConnectionTokenSet
  uid: string
  nowMs: number
  previous: PluginConnectionRecord | null
}): PluginConnectionRecord {
  const owner = { hostId: input.hostId, listingId: input.listingId, connectionId: input.connection.id }
  const choices = input.previous?.choices ?? {}
  const ready = connectionReady({ choices }, input.connection)
  return {
    kind: 'connection',
    ...owner,
    orgId: input.orgId,
    provider: input.connection.provider,
    status: 'connected',
    // A provider that issues no new refresh token on a re-consent keeps the
    // previous grant's, which it did not revoke.
    ...sealTokens(input.keyring, owner, input.tokens, input.previous?.sealedRefreshToken ?? ''),
    accessExpiresAtMs: input.tokens.accessExpiresAtMs,
    refreshedAtMs: input.nowMs,
    refreshLeaseUntilMs: 0,
    scopes: input.tokens.scopes,
    choices,
    connectedAtMs: input.nowMs,
    connectedByUid: input.uid,
    lastSyncAtMs: input.previous?.lastSyncAtMs ?? null,
    nextSyncAtMs: ready ? input.nowMs : null,
    lastError: null,
    updatedAtMs: input.nowMs,
  }
}

/** Refresh when the access token has less than this left. */
export const ACCESS_REFRESH_MARGIN_MS = 5 * 60 * 1000

const LEASE_MS = 30_000
const LEASE_WAITS = 6
const LEASE_WAIT_MS = 1000

export interface PluginConnectionTokenDeps {
  firestore: FirebaseFirestore.Firestore
  keyring: SecretBoxKeyring
  /** The declaration the record was made under (the site's pinned manifest). */
  connection: PluginConnectionDeclaration
  /** The publisher's OAuth app, opened. */
  client: PluginConnectionClient
  now: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Thrown when a grant can no longer be used and the site owner has to connect again. */
export class PluginConnectionReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginConnectionReconnectRequiredError'
  }
}

/** Whether a record's access token should be refreshed before use. */
export function accessTokenStale(record: Pick<PluginConnectionRecord, 'sealedAccessToken' | 'accessExpiresAtMs'>, nowMs: number): boolean {
  return !record.sealedAccessToken || record.accessExpiresAtMs - ACCESS_REFRESH_MARGIN_MS <= nowMs
}

/**
 * A usable access token for a connected record: the stored one, or a fresh
 * one under the lease when it is near expiry (or `force`, after a 401).
 */
export async function connectionAccessToken(
  deps: PluginConnectionTokenDeps,
  record: PluginConnectionRecord,
  options: { force?: boolean } = {},
): Promise<string> {
  if (record.status === 'reconnect_required') {
    throw new PluginConnectionReconnectRequiredError(record.lastError ?? 'Connect again.')
  }
  if (!options.force && !accessTokenStale(record, deps.now())) {
    return openToken(deps.keyring, record, 'access').token
  }
  return (await refreshConnection(deps, record)).accessToken
}

/**
 * Refreshes a grant under the lease and stores the rotated tokens. Answers
 * the access token now in force — this refresh's, or a concurrent one's.
 */
export async function refreshConnection(
  deps: PluginConnectionTokenDeps,
  record: PluginConnectionRecord,
): Promise<{ accessToken: string; refreshed: boolean }> {
  const ref = connectionRef(deps.firestore, record.hostId, record.listingId, record.connectionId)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const startedRefreshedAt = record.refreshedAtMs
  for (let wait = 0; wait <= LEASE_WAITS; wait += 1) {
    const claim = await deps.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = readConnection(snapshot.exists ? snapshot.data() : undefined)
      if (!current || current.status === 'reconnect_required') return { kind: 'gone' as const, current }
      // Someone else refreshed since we read: use theirs.
      if (current.refreshedAtMs > startedRefreshedAt && !accessTokenStale(current, deps.now())) {
        return { kind: 'fresh' as const, current }
      }
      if (current.refreshLeaseUntilMs > deps.now()) return { kind: 'held' as const, current }
      transaction.update(ref, { refreshLeaseUntilMs: deps.now() + LEASE_MS })
      return { kind: 'ours' as const, current }
    })
    if (claim.kind === 'gone') {
      throw new PluginConnectionReconnectRequiredError(claim.current?.lastError ?? 'Connect again.')
    }
    if (claim.kind === 'fresh') {
      return { accessToken: openToken(deps.keyring, claim.current, 'access').token, refreshed: false }
    }
    if (claim.kind === 'held') {
      await sleep(LEASE_WAIT_MS)
      continue
    }
    const current = claim.current
    if (!current.sealedRefreshToken) {
      // Nothing to refresh with: the provider never issued a refresh token.
      const message = 'The connection has expired. Connect again.'
      await ref.update({ status: 'reconnect_required', lastError: message, refreshLeaseUntilMs: 0, nextSyncAtMs: null, updatedAtMs: deps.now() })
      throw new PluginConnectionReconnectRequiredError(message)
    }
    let tokens: PluginConnectionTokenSet
    try {
      tokens = await refreshPluginConnectionToken(deps.connection, deps.client, openToken(deps.keyring, current, 'refresh').token)
    } catch (error) {
      if (error instanceof PluginConnectionProviderError && error.code === 'auth') {
        const message = error.message || 'The provider refused the connection. Connect again.'
        await ref.update({
          status: 'reconnect_required',
          lastError: message,
          refreshLeaseUntilMs: 0,
          nextSyncAtMs: null,
          updatedAtMs: deps.now(),
        })
        throw new PluginConnectionReconnectRequiredError(message)
      }
      await ref.update({ refreshLeaseUntilMs: 0 })
      throw error
    }
    const nowMs = deps.now()
    await ref.update({
      ...sealTokens(deps.keyring, current, tokens, current.sealedRefreshToken),
      accessExpiresAtMs: tokens.accessExpiresAtMs,
      refreshedAtMs: nowMs,
      refreshLeaseUntilMs: 0,
      updatedAtMs: nowMs,
    })
    return { accessToken: tokens.accessToken, refreshed: true }
  }
  throw new PluginConnectionProviderError('transient', 'Another refresh of this connection is still running.')
}

/**
 * Records a sync that ran (for the scheduled sync): its time, the next run,
 * and the status back to `connected` with no error. `update()`, never a
 * merge: a connection disconnected while the sync ran must not come back as
 * a stub.
 */
export async function markConnectionSynced(
  firestore: FirebaseFirestore.Firestore,
  record: TokenOwner,
  input: { nowMs: number; nextSyncAtMs: number },
): Promise<void> {
  await connectionRef(firestore, record.hostId, record.listingId, record.connectionId).update({
    status: 'connected',
    lastSyncAtMs: input.nowMs,
    nextSyncAtMs: input.nextSyncAtMs,
    lastError: null,
    syncFailures: 0,
    updatedAtMs: input.nowMs,
  })
}

/**
 * Records a failure (for the scheduled sync and the picker): `error` with the
 * next try scheduled, or `reconnect_required`, which stops the schedule until
 * the owner connects again. The message is the provider's sentence or ours,
 * never a token.
 */
export async function markConnectionError(
  firestore: FirebaseFirestore.Firestore,
  record: TokenOwner,
  input: { nowMs: number; message: string; reconnect: boolean; nextSyncAtMs?: number | null; syncFailures?: number },
): Promise<void> {
  await connectionRef(firestore, record.hostId, record.listingId, record.connectionId).update({
    status: input.reconnect ? 'reconnect_required' : 'error',
    lastError: input.message.slice(0, 300),
    nextSyncAtMs: input.reconnect ? null : (input.nextSyncAtMs ?? null),
    ...(input.syncFailures !== undefined ? { syncFailures: input.syncFailures } : {}),
    updatedAtMs: input.nowMs,
  })
}
