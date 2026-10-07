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

import type { CatalogOffer, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { syncDocId } from '../../constants/bundle-common'
import { salesChannel } from '../../model/channels'
import { resolveOffer, type FeedRow } from '../../model/feed-columns'
import type { SalesChannelSettings } from '../../model/settings'
import { readOffers, readStore } from '../catalog-source'
import { channelsCollection, firestore, getSettings } from '../feed-store'
import type { ProviderConfig } from './config'
import { openConnectionToken, updateConnection, type ConnectionDocument } from './connection-store'
import {
  GOOGLE_INSERT_CONCURRENCY,
  googleAccessToken,
  googleCreateDataSource,
  googleDeleteProduct,
  googleFeedLabel,
  googleInsertProduct,
  googleProductInput,
} from './google-merchant'
import { connectRuntime, eachLimited } from './http'
import { chunk, META_BATCH_SIZE, metaItemData, metaPostBatch, type MetaBatchRequest } from './meta-catalog'

/**
 * A SYNC: THE STORE'S CATALOG PUSHED TO A CONNECTED CHANNEL (AGL-3637, phase 2).
 *
 * Reads the offers the feed would list — the same `resolveOffer`, the same
 * inclusion rules and values — and sends each one the channel's feed
 * includes; an offer sent last time that the feed no longer includes (left
 * out, or gone from the store) is deleted. The ids sent are kept on the
 * provider's sync record, bounded, and a catalog read that stopped short is
 * never used to delete: what it did not read is not known to be gone.
 *
 * One sync per site and provider at a time: a lease on the same record,
 * taken in a transaction, refuses a second click while the first runs, and
 * expires on its own if a run dies holding it.
 */

/** The most offers one sync reads. */
export const SYNC_MAX_OFFERS = 10_000
/** The most sent offer ids kept for the next sync's deletes. */
export const SYNC_MAX_TRACKED_IDS = 10_000
/** How long a sync holds its lease. */
export const SYNC_LEASE_MS = 10 * 60 * 1000
/** Errors kept on the connection, first first. */
export const SYNC_MAX_ERRORS = 10

export interface SyncResult {
  sent: number
  failed: number
  errors: string[]
  /** How many earlier-sent offers were deleted. */
  deleted?: number
  /** The catalog was larger than one sync reads. */
  partial?: boolean
}

export class SyncBusyError extends Error {
  constructor() {
    super('A sync is already running for this channel. Try again in a few minutes.')
    this.name = 'SyncBusyError'
  }
}

export class SyncRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncRefusedError'
  }
}

const syncRef = (hostId: string, provider: string) => channelsCollection(hostId).doc(syncDocId(provider))

/** Takes the lease, or throws {@link SyncBusyError}. Answers the ids sent last time. */
export async function acquireSyncLease(input: {
  hostId: string
  provider: ConnectionDocument['provider']
  uid: string
  nowMs: number
}): Promise<string[]> {
  const ref = syncRef(input.hostId, input.provider)
  return firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = (snapshot.exists ? snapshot.data() : undefined) ?? {}
    if (Number(data['leaseUntilMs']) > input.nowMs) throw new SyncBusyError()
    transaction.set(
      ref,
      { leaseUntilMs: input.nowMs + SYNC_LEASE_MS, leaseBy: input.uid, leaseAtMs: input.nowMs },
      { merge: true },
    )
    return Array.isArray(data['sentIds']) ? (data['sentIds'] as unknown[]).map(String) : []
  })
}

/** Releases the lease and keeps the ids now held by the channel. */
export async function releaseSyncLease(input: {
  hostId: string
  provider: ConnectionDocument['provider']
  sentIds: string[] | null
}): Promise<void> {
  await syncRef(input.hostId, input.provider).set(
    {
      leaseUntilMs: 0,
      ...(input.sentIds ? { sentIds: input.sentIds.slice(0, SYNC_MAX_TRACKED_IDS) } : {}),
    },
    { merge: true },
  )
}

/** Forgets what was sent: a disconnect, or a new account or catalog. */
export async function clearSyncRecord(hostId: string, provider: ConnectionDocument['provider']): Promise<void> {
  await syncRef(hostId, provider).delete()
}

interface Included {
  offer: CatalogOffer
  row: FeedRow
}

/** The offers the provider's feed includes, by the feed's own rules. */
export function includedOffers(
  provider: ConnectionDocument['provider'],
  offers: readonly CatalogOffer[],
  store: CatalogStore,
  settings: SalesChannelSettings,
): Included[] {
  const channel = salesChannel(provider)
  if (!channel) return []
  const included: Included[] = []
  for (const offer of offers) {
    const resolved = resolveOffer(offer, { channel, store, settings })
    if (resolved.included) included.push({ offer, row: resolved.row })
  }
  return included
}

class Tally {
  sent = 0
  failed = 0
  deleted = 0
  errors: string[] = []
  fail(id: string, message: string) {
    this.failed += 1
    if (this.errors.length < SYNC_MAX_ERRORS) this.errors.push(`${id}: ${message}`)
  }
}

interface SyncContext {
  hostId: string
  config: ProviderConfig
  connection: ConnectionDocument
  token: string
  store: CatalogStore
  included: Included[]
  removed: string[]
  allOffers: readonly CatalogOffer[]
  tally: Tally
}

/** Answers the ids the channel holds after the run. */
async function syncGoogle(context: SyncContext): Promise<string[]> {
  const { connection, store, included, removed, tally } = context
  const accessToken = await googleAccessToken(context.config, context.token)
  const feedLabel = googleFeedLabel(store, context.allOffers)
  let dataSource = connection.scheduledFeedId ?? ''
  if (!dataSource.startsWith(`accounts/${connection.targetId}/`)) {
    dataSource = await googleCreateDataSource(accessToken, {
      accountId: connection.targetId,
      feedLabel,
      displayName: `${store.name || 'Store'} (${PLATFORM_BRAND_NAME})`,
    })
    await updateConnection(context.hostId, 'google', { scheduledFeedId: dataSource })
  }
  const held = new Set<string>()
  await eachLimited(included, GOOGLE_INSERT_CONCURRENCY, async ({ offer, row }) => {
    try {
      await googleInsertProduct(accessToken, {
        accountId: connection.targetId,
        dataSource,
        product: googleProductInput(offer, row, { store, feedLabel }),
      })
      tally.sent += 1
      held.add(offer.id)
    } catch (error) {
      tally.fail(offer.id, (error as Error).message)
    }
  })
  await eachLimited(removed, GOOGLE_INSERT_CONCURRENCY, async (offerId) => {
    try {
      await googleDeleteProduct(accessToken, { accountId: connection.targetId, dataSource, feedLabel, offerId })
      tally.deleted += 1
    } catch (error) {
      held.add(offerId)
      tally.fail(offerId, (error as Error).message)
    }
  })
  return [...held]
}

async function syncMeta(context: SyncContext): Promise<string[]> {
  const { config, connection, token, store, included, removed, tally } = context
  const requests: MetaBatchRequest[] = [
    ...included.map(({ row }): MetaBatchRequest => ({ method: 'UPDATE', data: metaItemData(row, store) })),
    ...removed.map((id): MetaBatchRequest => ({ method: 'DELETE', data: { id } })),
  ]
  const held = new Set<string>()
  for (const part of chunk(requests, META_BATCH_SIZE)) {
    try {
      const outcome = await metaPostBatch(config, token, { catalogId: connection.targetId, requests: part })
      for (const request of part) {
        const id = String(request.data['id'])
        const refused = outcome.refused.get(id)
        if (refused) {
          tally.fail(id, refused)
          if (request.method === 'DELETE') held.add(id)
          continue
        }
        if (request.method === 'UPDATE') {
          tally.sent += 1
          held.add(id)
        } else {
          tally.deleted += 1
        }
      }
    } catch (error) {
      for (const request of part) {
        const id = String(request.data['id'])
        tally.fail(id, (error as Error).message)
        if (request.method === 'DELETE') held.add(id)
      }
    }
  }
  return [...held]
}

/**
 * Runs one sync of a connected site to its channel, under the lease.
 * Records the result on the connection, whatever it was.
 */
export async function runSync(input: {
  hostId: string
  uid: string
  config: ProviderConfig
  connection: ConnectionDocument
}): Promise<SyncResult> {
  const { hostId, config, connection } = input
  const provider = connection.provider
  if (!connection.targetId) {
    throw new SyncRefusedError(
      provider === 'google' ? 'Choose a Merchant Center account first.' : 'Choose a catalog first.',
    )
  }
  const nowMs = connectRuntime.now()
  if (provider === 'meta' && connection.tokenExpiresAtMs && connection.tokenExpiresAtMs <= nowMs) {
    throw new SyncRefusedError('The Facebook connection has expired. Reconnect Meta.')
  }
  const previouslySent = await acquireSyncLease({ hostId, provider, uid: input.uid, nowMs })
  let heldAfter: string[] | null = null
  const tally = new Tally()
  let partial = false
  try {
    const store = await readStore(hostId)
    if (!store) throw new SyncRefusedError('This site has no store to list.')
    const [{ offers, partial: cut }, settings] = await Promise.all([
      readOffers(hostId, SYNC_MAX_OFFERS),
      getSettings(hostId),
    ])
    partial = cut
    const included = includedOffers(provider, offers, store, settings)
    const includedIds = new Set(included.map(({ offer }) => offer.id))
    const removed = cut ? [] : previouslySent.filter((id) => !includedIds.has(id))
    const token = openConnectionToken(connection, config.keyring, hostId)
    const context: SyncContext = { hostId, config, connection, token, store, included, removed, allOffers: offers, tally }
    const held = provider === 'google' ? await syncGoogle(context) : await syncMeta(context)
    // A partial read never deletes, so what was sent before stays tracked.
    heldAfter = cut ? [...new Set([...held, ...previouslySent])] : held
  } catch (error) {
    if (error instanceof SyncRefusedError) throw error
    tally.fail('sync', (error as Error).message)
  } finally {
    await releaseSyncLease({ hostId, provider, sentIds: heldAfter }).catch((error) =>
      console.warn('sales-channels: lease release failed', error),
    )
  }
  const result: SyncResult = {
    sent: tally.sent,
    failed: tally.failed,
    errors: tally.errors,
    deleted: tally.deleted,
    ...(partial ? { partial: true } : {}),
  }
  await updateConnection(hostId, provider, { lastSyncAtMs: connectRuntime.now(), lastSyncResult: result })
  return result
}
