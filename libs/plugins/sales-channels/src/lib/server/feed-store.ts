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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  feedDocId,
  SALES_CHANNELS_COLLECTION,
  SALES_CHANNELS_SETTINGS_DOC,
} from '../constants/bundle-common'
import { SALES_CHANNEL_IDS, type SalesChannelId } from '../model/channels'
import { normalizeSalesChannelSettings, type SalesChannelSettings } from '../model/settings'

/**
 * A SITE'S CHANNEL STATE (AGL-3637), on `hosts/{hostId}/salesChannels`.
 *
 * Every document there is this plugin's alone: written on the Admin SDK by
 * its routes, and refused to every client by the Firestore rules, staff
 * included, because a feed document holds the feed's token — the one thing
 * that keeps a store's catalog file from being read by anyone who can guess
 * its site id.
 */

type Firestore = FirebaseFirestore.Firestore

export interface FeedDocument {
  channel: SalesChannelId
  enabled: boolean
  /** 32 random bytes, base64url: the file name in the feed's URL. */
  token: string
  createdAtMs: number
  createdBy: string
  rotatedAtMs?: number
  rotatedBy?: string
  /**
   * Google only: the address Merchant Center was given before the channels
   * existed (`/api/commerce/feed?hostId=`) no longer answers. Set by a
   * rotation or by the merchant turning it off.
   */
  legacyRetired?: boolean
  /** The last time a channel read the feed, epoch ms. */
  lastFetchAtMs?: number
  /** Who read it, from the request's user agent. */
  lastFetchAgent?: string
}

/** The fewest minutes between two fetch stamps on one feed, so a crawler loop writes little. */
export const FETCH_STAMP_INTERVAL_MS = 15 * 60 * 1000

export const firestore = (): Firestore => firebaseAdmin.app().firestore()

export const isDocumentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  !value.includes('/') &&
  !/^__.*__$/.test(value)

export function channelsCollection(hostId: string) {
  return firestore().collection('hosts').doc(hostId).collection(SALES_CHANNELS_COLLECTION)
}

/** A new feed token: unguessable, URL-safe, and a valid file name. */
export function mintFeedToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Whether a presented token is the feed's, in time that does not depend on how much matched. */
export function tokenMatches(presented: string, stored: string | undefined): boolean {
  if (!stored || !presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(stored).digest()
  return timingSafeEqual(a, b)
}

export function readFeedDocument(raw: FirebaseFirestore.DocumentData | undefined): FeedDocument | null {
  if (!raw) return null
  const channel = String(raw['channel'] ?? '') as SalesChannelId
  if (!SALES_CHANNEL_IDS.includes(channel)) return null
  const token = typeof raw['token'] === 'string' ? raw['token'] : ''
  return {
    channel,
    enabled: raw['enabled'] === true && Boolean(token),
    token,
    createdAtMs: Number(raw['createdAtMs']) || 0,
    createdBy: String(raw['createdBy'] ?? ''),
    ...(Number(raw['rotatedAtMs']) ? { rotatedAtMs: Number(raw['rotatedAtMs']) } : {}),
    ...(raw['rotatedBy'] ? { rotatedBy: String(raw['rotatedBy']) } : {}),
    ...(raw['legacyRetired'] === true ? { legacyRetired: true } : {}),
    ...(Number(raw['lastFetchAtMs']) ? { lastFetchAtMs: Number(raw['lastFetchAtMs']) } : {}),
    ...(raw['lastFetchAgent'] ? { lastFetchAgent: String(raw['lastFetchAgent']).slice(0, 120) } : {}),
  }
}

export async function getFeed(hostId: string, channel: SalesChannelId): Promise<FeedDocument | null> {
  const snapshot = await channelsCollection(hostId).doc(feedDocId(channel)).get()
  return snapshot.exists ? readFeedDocument(snapshot.data()) : null
}

/**
 * Every channel's feed and the settings, each read by its id: the collection
 * also holds API connections, sync records and pending OAuth states, which
 * a listing would have to page past.
 */
export async function getChannelState(hostId: string): Promise<{
  feeds: Partial<Record<SalesChannelId, FeedDocument>>
  settings: SalesChannelSettings
}> {
  const collection = channelsCollection(hostId)
  const [settingsSnapshot, ...feedSnapshots] = await Promise.all([
    collection.doc(SALES_CHANNELS_SETTINGS_DOC).get(),
    ...SALES_CHANNEL_IDS.map((channel) => collection.doc(feedDocId(channel)).get()),
  ])
  const feeds: Partial<Record<SalesChannelId, FeedDocument>> = {}
  SALES_CHANNEL_IDS.forEach((channel, index) => {
    const feed = feedSnapshots[index].exists ? readFeedDocument(feedSnapshots[index].data()) : null
    if (feed && feed.channel === channel) feeds[channel] = feed
  })
  return { feeds, settings: normalizeSalesChannelSettings(settingsSnapshot.data()) }
}

export async function getSettings(hostId: string): Promise<SalesChannelSettings> {
  const snapshot = await channelsCollection(hostId).doc(SALES_CHANNELS_SETTINGS_DOC).get()
  return normalizeSalesChannelSettings(snapshot.data())
}

/**
 * Switches a channel's feed on or off. Switching on mints its token the
 * first time and keeps it after, so a URL a channel already holds goes on
 * working when a merchant switches a feed off and on again. In a
 * transaction, so two tabs switching on at once mint one token.
 */
export async function setFeedEnabled(input: {
  hostId: string
  channel: SalesChannelId
  enabled: boolean
  uid: string
  nowMs?: number
}): Promise<FeedDocument> {
  const ref = channelsCollection(input.hostId).doc(feedDocId(input.channel))
  const nowMs = input.nowMs ?? Date.now()
  return firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const held = snapshot.exists ? readFeedDocument(snapshot.data()) : null
    const next: FeedDocument = held?.token
      ? { ...held, enabled: input.enabled }
      : {
          channel: input.channel,
          enabled: input.enabled,
          token: mintFeedToken(),
          createdAtMs: nowMs,
          createdBy: input.uid,
        }
    transaction.set(ref, next)
    return next
  })
}

/**
 * Replaces a feed's token: the old URL stops answering at once. Google's
 * rotation retires the pre-channels address too, since a merchant rotating
 * because a URL leaked means every way in.
 */
export async function rotateFeedToken(input: {
  hostId: string
  channel: SalesChannelId
  uid: string
  nowMs?: number
}): Promise<FeedDocument> {
  const ref = channelsCollection(input.hostId).doc(feedDocId(input.channel))
  const nowMs = input.nowMs ?? Date.now()
  return firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const held = snapshot.exists ? readFeedDocument(snapshot.data()) : null
    const next: FeedDocument = {
      ...(held ?? { channel: input.channel, enabled: true, createdAtMs: nowMs, createdBy: input.uid }),
      channel: input.channel,
      token: mintFeedToken(),
      rotatedAtMs: nowMs,
      rotatedBy: input.uid,
      ...(input.channel === 'google' ? { legacyRetired: true } : {}),
    } as FeedDocument
    delete next.lastFetchAtMs
    delete next.lastFetchAgent
    transaction.set(ref, next)
    return next
  })
}

/** Turns off the pre-channels Google address without touching the channel's own URL. */
export async function retireLegacyGoogleFeed(input: { hostId: string; uid: string; nowMs?: number }): Promise<FeedDocument> {
  const ref = channelsCollection(input.hostId).doc(feedDocId('google'))
  const nowMs = input.nowMs ?? Date.now()
  return firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const held = snapshot.exists ? readFeedDocument(snapshot.data()) : null
    const next: FeedDocument = held
      ? { ...held, legacyRetired: true }
      : {
          channel: 'google',
          enabled: false,
          token: mintFeedToken(),
          createdAtMs: nowMs,
          createdBy: input.uid,
          legacyRetired: true,
        }
    transaction.set(ref, next)
    return next
  })
}

export async function saveSettings(input: {
  hostId: string
  settings: SalesChannelSettings
  uid: string
  nowMs?: number
}): Promise<SalesChannelSettings> {
  const settings = normalizeSalesChannelSettings(input.settings)
  await channelsCollection(input.hostId)
    .doc(SALES_CHANNELS_SETTINGS_DOC)
    .set({ ...settings, updatedAtMs: input.nowMs ?? Date.now(), updatedBy: input.uid })
  return settings
}

/**
 * Notes that a channel read the feed, at most once per
 * {@link FETCH_STAMP_INTERVAL_MS}, so the card can say when it last did.
 * Never throws: a stamp that fails must not fail the feed.
 */
export async function stampFetch(input: {
  hostId: string
  channel: SalesChannelId
  feed: FeedDocument | null
  agent: string
  nowMs?: number
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now()
  if (!input.feed) return
  if (input.feed.lastFetchAtMs && nowMs - input.feed.lastFetchAtMs < FETCH_STAMP_INTERVAL_MS) return
  try {
    await channelsCollection(input.hostId)
      .doc(feedDocId(input.channel))
      .update({ lastFetchAtMs: nowMs, lastFetchAgent: input.agent.slice(0, 120) })
  } catch (error) {
    console.warn('sales-channels: fetch stamp failed', error)
  }
}
