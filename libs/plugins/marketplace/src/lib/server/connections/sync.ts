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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  readPluginConnectionPath,
  type PluginConnectionDeclaration,
  type PluginConnectionSync,
  type PluginConnectionSyncRequest,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import type { PluginConsoleCronContext, PluginConsoleCronReport } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { PLUGIN_CONNECTIONS_FEATURE, PLUGIN_CONNECTIONS_HOST_COLLECTION } from '../../model/plugin-connections'
import { readPluginConnectionsKeyring } from './config'
import { forgetSiteConnection, pinnedConnectionState } from './cleanup'
import {
  connectionAccessToken,
  connectionReady,
  connectionRecordRef,
  connectionRef,
  markConnectionError,
  markConnectionSynced,
  PluginConnectionReconnectRequiredError,
  readConnection,
  type PluginConnectionRecord,
  type PluginConnectionTokenDeps,
} from './connection-store'
import { openCredentials } from './credentials-store'
import { latestListingConnections } from './installed-connection'
import {
  pluginConnectionApiRequest,
  pluginConnectionRuntime,
  PluginConnectionProviderError,
  type PluginConnectionClient,
} from './provider-http'
import {
  mapPluginConnectionRecord,
  pluginConnectionSyncRequestsRead,
  type PluginConnectionSyncAnswer,
} from './record-mapping'

/**
 * THE DECLARED SYNC, RUN BY THE PLATFORM (AGL-4194).
 *
 * A connection's manifest declares `sync`: a few templated requests, an
 * interval, and the typed record its answers map into. This runs it, in the
 * CONSOLE only — it opens sealed grants with `PLUGIN_CONNECTIONS_TOKEN_KEY`,
 * which the tenant never holds:
 *
 *   - on the console's fifteen-minute `plugin-console-crons` tick, as the
 *     `marketplace-connection-sync` job ({@link runPluginConnectionSyncJob}),
 *     for every connection whose `nextSyncAtMs` has come, oldest first,
 *     {@link PLUGIN_CONNECTION_SYNC_MAX_PER_TICK} at most per tick;
 *   - on "Sync now" (`POST plugin-connections/sync`), for one connection.
 *
 * One sync ({@link runConnectionSync}):
 *
 *   1. under the declaration of the version the site has PINNED, never the
 *      listing's newest;
 *   2. with the site's access token, refreshed under the store's lease when
 *      it is near expiry, and once more on a 401 or 403 from the API;
 *   3. each request the record reads, filled from the site's choices by
 *      `preparePluginConnectionRequest` (which refuses anything off the
 *      declared `apiHosts`), page by page up to the declared `maxPages` and
 *      the record's `maxItems`, each answer under the 2 MB ceiling and the
 *      per-attempt timeout of `provider-http.ts`, and no page started after
 *      the sync's own time budget;
 *   4. mapped into the record (`record-mapping.ts`: undeclared keys dropped,
 *      strings cut, the whole record bounded) and written WHOLE to
 *      `hosts/{hostId}/pluginConnections/record-{listingId}__{connectionId}`,
 *      which no client rule opens;
 *   5. then the connection is marked synced, next due `intervalHours` on.
 *
 * Failures: a grant the provider refuses (`invalid_grant`, a 401 after a
 * fresh token) is `reconnect_required`, and the schedule stops until the
 * owner connects again. Anything else is `error` with the provider's
 * sentence, retried after a backoff that doubles from fifteen minutes up to
 * the declared interval. The last good record stays in place either way.
 *
 * Skipped quietly, with nothing written: the whole tick when the key is unset.
 * Deferred, with only the next due time moved: a site whose plan has no
 * connections, and a pinned version the kill switch revoked. Forgotten
 * (revoked and deleted, `cleanup.ts`): a connection whose site no longer runs
 * a version that declares it.
 */

/** The job id: its `platformCronBeats` mark and its row on `/api/health/crons`. */
export const PLUGIN_CONNECTION_SYNC_JOB_ID = 'marketplace-connection-sync'

/** Connections synced at most per tick; the rest wait for the next, oldest first. */
export const PLUGIN_CONNECTION_SYNC_MAX_PER_TICK = 25

/** Connections synced at once within a tick. */
const CONCURRENCY = 4

/** How long one sync may keep starting pages. */
export const PLUGIN_CONNECTION_SYNC_BUDGET_MS = 60_000

/** The first retry after a failed sync; it doubles up to the declared interval. */
export const PLUGIN_CONNECTION_SYNC_MIN_BACKOFF_MS = 15 * 60 * 1000

/** How far a deferred connection (plan, kill switch, no workspace) is moved on. */
export const PLUGIN_CONNECTION_SYNC_DEFER_MS = 6 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000

const firestore = (): FirebaseFirestore.Firestore => firebaseAdmin.app().firestore()

/** The retry delay after `failures` failed syncs in a row, capped at the interval. */
export function pluginConnectionSyncBackoffMs(failures: number, intervalHours: number): number {
  const cap = Math.max(PLUGIN_CONNECTION_SYNC_MIN_BACKOFF_MS, intervalHours * HOUR_MS)
  const exponent = Math.min(Math.max(0, failures - 1), 20)
  return Math.min(cap, PLUGIN_CONNECTION_SYNC_MIN_BACKOFF_MS * 2 ** exponent)
}

/** What one sync came to. */
export type PluginConnectionSyncOutcome =
  | 'synced'
  | 'error'
  | 'reconnect'
  | 'not-ready'
  | 'no-sync'
  | 'deferred'
  | 'forgotten'
  | 'gone'

const isNotFound = (error: unknown) =>
  Boolean(error) && ((error as { code?: unknown }).code === 5 || /NOT_FOUND/.test(String((error as Error)?.message)))

/** An update to a connection that may have been disconnected meanwhile: a missing document is not an error. */
async function updateIfPresent(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write()
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

/**
 * One declared request, page by page: every page's body (the summary fields
 * read the first) and the items across pages, up to `maxItems`. A 401 or 403
 * refreshes the token once for the whole sync; a second one is final.
 */
async function fetchSyncRequest(
  connection: PluginConnectionDeclaration,
  request: PluginConnectionSyncRequest,
  input: {
    token: { current: string; refreshed: boolean; refresh: () => Promise<string> }
    choices: Readonly<Record<string, string>>
    maxItems: number
    deadlineMs: number
  },
): Promise<PluginConnectionSyncAnswer> {
  const pages: unknown[] = []
  const items: unknown[] = []
  let cursor: string | null = null
  const maxPages = input.maxItems > 0 ? (request.pagination?.maxPages ?? 1) : 1
  for (let page = 0; page < maxPages; page += 1) {
    if (pluginConnectionRuntime.now() >= input.deadlineMs) {
      if (page === 0) throw new PluginConnectionProviderError('transient', 'The sync ran out of time. It will try again.')
      break
    }
    let body: unknown
    try {
      body = await pluginConnectionApiRequest(connection, request, { accessToken: input.token.current, choices: input.choices, cursor })
    } catch (error) {
      if (!(error instanceof PluginConnectionProviderError) || error.code !== 'auth' || input.token.refreshed) throw error
      input.token.current = await input.token.refresh()
      input.token.refreshed = true
      body = await pluginConnectionApiRequest(connection, request, { accessToken: input.token.current, choices: input.choices, cursor })
    }
    pages.push(body)
    if (input.maxItems <= 0) break
    const list = request.itemsPath ? readPluginConnectionPath(body, request.itemsPath) : undefined
    if (Array.isArray(list)) items.push(...list.slice(0, Math.max(0, input.maxItems - items.length)))
    if (items.length >= input.maxItems || !request.pagination) break
    const next = readPluginConnectionPath(body, request.pagination.cursorPath)
    if (typeof next !== 'string' || !next || next.length > 2048 || next === cursor) break
    cursor = next
  }
  return { pages, items }
}

/** The items a request feeds into the record, or 0 for one only summary fields read. */
function itemsWanted(sync: PluginConnectionSync, requestId: string): number {
  return sync.record.items?.request === requestId ? sync.record.items.maxItems : 0
}

export interface RunConnectionSyncInput {
  keyring: SecretBoxKeyring
  record: PluginConnectionRecord
  connection: PluginConnectionDeclaration
  /** The pinned version the declaration came from. */
  version: string
  client: PluginConnectionClient
  /** Start no page after this, epoch ms. */
  deadlineMs: number
}

/**
 * Runs one connection's declared sync and records the outcome on the
 * connection. Never throws for a provider's failure; a Firestore failure
 * propagates.
 */
export async function runConnectionSync(input: RunConnectionSyncInput): Promise<PluginConnectionSyncOutcome> {
  const { record, connection } = input
  const db = firestore()
  const ref = connectionRef(db, record.hostId, record.listingId, record.connectionId)
  const sync = connection.sync
  if (!sync) {
    // Nothing declared to run: off the schedule until a version declares one.
    await updateIfPresent(() => ref.update({ nextSyncAtMs: null, updatedAtMs: pluginConnectionRuntime.now() }))
    return 'no-sync'
  }
  if (!connectionReady(record, connection)) {
    // The choose route puts it back on the schedule once every resource is chosen.
    await updateIfPresent(() => ref.update({ nextSyncAtMs: null, updatedAtMs: pluginConnectionRuntime.now() }))
    return 'not-ready'
  }
  const choices = Object.fromEntries(Object.entries(record.choices).map(([key, choice]) => [key, choice.id]))
  const tokenDeps: PluginConnectionTokenDeps = {
    firestore: db,
    keyring: input.keyring,
    connection,
    client: input.client,
    now: pluginConnectionRuntime.now,
    sleep: pluginConnectionRuntime.sleep,
  }
  try {
    const token = {
      current: await connectionAccessToken(tokenDeps, record),
      refreshed: false,
      refresh: () => connectionAccessToken(tokenDeps, record, { force: true }),
    }
    const answers: Record<string, PluginConnectionSyncAnswer> = {}
    for (const request of pluginConnectionSyncRequestsRead(sync)) {
      answers[request.id] = await fetchSyncRequest(connection, request, {
        token,
        choices,
        maxItems: itemsWanted(sync, request.id),
        deadlineMs: input.deadlineMs,
      })
    }
    const nowMs = pluginConnectionRuntime.now()
    const doc = mapPluginConnectionRecord(sync, answers, {
      listingId: record.listingId,
      connectionId: record.connectionId,
      version: input.version,
      syncedAtMs: nowMs,
    })
    const recordRef = connectionRecordRef(db, record.hostId, record.listingId, record.connectionId)
    // Whole, never merged: a key the new schema dropped must not survive.
    await recordRef.set(doc)
    const marked = await updateIfPresent(() =>
      markConnectionSynced(db, record, { nowMs, nextSyncAtMs: nowMs + sync.intervalHours * HOUR_MS }),
    )
    if (!marked) {
      // Disconnected while it ran: the record must not outlive the grant.
      await recordRef.delete()
      return 'gone'
    }
    return 'synced'
  } catch (error) {
    const nowMs = pluginConnectionRuntime.now()
    const grantGone =
      error instanceof PluginConnectionReconnectRequiredError ||
      (error instanceof PluginConnectionProviderError && error.code === 'auth' && error.status === 401)
    if (grantGone) {
      const message =
        error instanceof PluginConnectionReconnectRequiredError
          ? error.message
          : `${connection.label} refused the connection. Connect again.`
      await updateIfPresent(() => markConnectionError(db, record, { nowMs, message, reconnect: true }))
      return 'reconnect'
    }
    if (!(error instanceof PluginConnectionProviderError)) {
      console.error('plugin-connections: a sync failed', error instanceof Error ? error.message : error)
    }
    const message =
      error instanceof PluginConnectionProviderError
        ? `${connection.label} did not answer: ${error.message}`
        : 'The sync failed. It will try again.'
    const failures = (record.syncFailures ?? 0) + 1
    await updateIfPresent(() =>
      markConnectionError(db, record, {
        nowMs,
        message,
        reconnect: false,
        nextSyncAtMs: nowMs + pluginConnectionSyncBackoffMs(failures, sync.intervalHours),
        syncFailures: failures,
      }),
    )
    return 'error'
  }
}

/** Moves a connection's next run on without touching its status. */
async function defer(record: PluginConnectionRecord, nowMs: number): Promise<void> {
  await updateIfPresent(() =>
    connectionRef(firestore(), record.hostId, record.listingId, record.connectionId).update({
      nextSyncAtMs: nowMs + PLUGIN_CONNECTION_SYNC_DEFER_MS,
      updatedAtMs: nowMs,
    }),
  )
}

/** The declaration to revoke an orphan with: the listing's newest version's, the pin being gone. */
async function orphanDeclaration(listingId: string, connectionId: string): Promise<PluginConnectionDeclaration | null> {
  try {
    const listing = await firestore().collection('marketplaceListings').doc(listingId).get()
    const declared = await latestListingConnections(firestore(), listingId, String(listing.get('latestVersion') ?? ''))
    return declared.find((one) => one.id === connectionId) ?? null
  } catch {
    return null
  }
}

/** One due connection: gates, then the sync. */
export async function syncDueConnection(
  keyring: SecretBoxKeyring,
  record: PluginConnectionRecord,
  deadlineMs: number,
): Promise<PluginConnectionSyncOutcome> {
  const nowMs = pluginConnectionRuntime.now()
  const resolved = await getOrgForHost(record.hostId)
  if (!resolved) {
    const host = await firestore().collection('hosts').doc(record.hostId).get()
    if (!host.exists) {
      // The site is gone and its eraser missed this: revoke and forget.
      await forgetSiteConnection(firestore(), record, {
        orgId: record.orgId || null,
        declaration: await orphanDeclaration(record.listingId, record.connectionId),
      })
      return 'forgotten'
    }
    await defer(record, nowMs)
    return 'deferred'
  }
  if (!checkEntitlement(resolved.org as never, PLUGIN_CONNECTIONS_FEATURE)) {
    // A plan without connections keeps its grant and its last record; it is
    // not run. Sync now (plan-gated) is how an upgrade gets a fresh one at once.
    await defer(record, nowMs)
    return 'deferred'
  }
  const pinned = await pinnedConnectionState(firestore(), {
    hostId: record.hostId,
    orgId: resolved.orgId,
    listingId: record.listingId,
    connectionId: record.connectionId,
  })
  if (pinned.state === 'gone') {
    await forgetSiteConnection(firestore(), record, {
      orgId: resolved.orgId,
      declaration: await orphanDeclaration(record.listingId, record.connectionId),
    })
    return 'forgotten'
  }
  if (pinned.state === 'paused') {
    await defer(record, nowMs)
    return 'deferred'
  }
  let client: PluginConnectionClient | null = null
  try {
    client = await openCredentials(firestore(), keyring, record.listingId, record.connectionId)
  } catch (error) {
    console.error('plugin-connections: a listing’s credentials did not open', error instanceof Error ? error.message : error)
  }
  if (!client) {
    const failures = (record.syncFailures ?? 0) + 1
    await updateIfPresent(() =>
      markConnectionError(firestore(), record, {
        nowMs,
        message: 'The plugin’s publisher has not finished setting up this connection yet.',
        reconnect: false,
        nextSyncAtMs: nowMs + pluginConnectionSyncBackoffMs(failures, pinned.connection.sync?.intervalHours ?? 24),
        syncFailures: failures,
      }),
    )
    return 'error'
  }
  return runConnectionSync({
    keyring,
    record,
    connection: pinned.connection,
    version: pinned.installed.version,
    client,
    deadlineMs: Math.min(deadlineMs, nowMs + PLUGIN_CONNECTION_SYNC_BUDGET_MS),
  })
}

/**
 * The due connections, oldest first: a collection-group query over every
 * site's `pluginConnections`, which needs its `COLLECTION_GROUP` index
 * (`kind`, `status`, `nextSyncAtMs`) in `cloud/firebase-firestore.indexes.json`.
 * `error` is included: its `nextSyncAtMs` is the backoff. A
 * `reconnect_required` connection has none, so it is never due.
 */
export async function dueConnections(nowMs: number, limit = PLUGIN_CONNECTION_SYNC_MAX_PER_TICK): Promise<PluginConnectionRecord[]> {
  const snapshot = await firestore()
    .collectionGroup(PLUGIN_CONNECTIONS_HOST_COLLECTION)
    .where('kind', '==', 'connection')
    .where('status', 'in', ['connected', 'error'])
    .where('nextSyncAtMs', '<=', nowMs)
    .orderBy('nextSyncAtMs', 'asc')
    .limit(limit)
    .get()
  return snapshot.docs
    .map((doc) => {
      const record = readConnection(doc.data())
      // The site is the one the document sits under, whatever it says.
      const hostId = doc.ref.parent.parent?.id
      return record && hostId ? { ...record, hostId } : null
    })
    .filter((record): record is PluginConnectionRecord => Boolean(record))
}

/**
 * The `marketplace-connection-sync` console job: every due connection, a few
 * at a time, none started after the tick's deadline. Reports counts only.
 */
export async function runPluginConnectionSyncJob(context: PluginConsoleCronContext): Promise<PluginConsoleCronReport> {
  const keyring = readPluginConnectionsKeyring()
  if (!keyring) return { configured: false }
  const due = await dueConnections(context.nowMs)
  const counts: Record<PluginConnectionSyncOutcome | 'failed' | 'notStarted', number> = {
    synced: 0,
    error: 0,
    reconnect: 0,
    'not-ready': 0,
    'no-sync': 0,
    deferred: 0,
    forgotten: 0,
    gone: 0,
    failed: 0,
    notStarted: 0,
  }
  let next = 0
  const worker = async () => {
    while (next < due.length) {
      const record = due[next++]
      if (pluginConnectionRuntime.now() >= context.deadlineMs) {
        counts.notStarted += 1
        continue
      }
      try {
        counts[await syncDueConnection(keyring, record, context.deadlineMs)] += 1
      } catch (error) {
        counts.failed += 1
        console.error('plugin-connections: a due connection failed', error instanceof Error ? error.message : error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))
  return {
    configured: true,
    due: due.length,
    synced: counts.synced,
    errors: counts.error + counts.failed,
    reconnectRequired: counts.reconnect,
    deferred: counts.deferred,
    forgotten: counts.forgotten,
    notReady: counts['not-ready'] + counts['no-sync'],
    notStarted: counts.notStarted,
  }
}
