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

// The decisions of the account-acquisition backfill (AGL-3289), kept apart
// from the script that reads and writes so every one of them is pinned by
// `account-acquisition-backfill.test.mjs`.
//
// An account created before the first-touch capture existed has no record of
// where it came from, and the staff Acquisition card would render blank for
// it — which reads as "never asked" rather than "asked before we could
// answer". The backfill stamps those accounts `source: 'unknown'`, marked as
// the backfill's, and fills only what the platform can still honestly say:
// when the auth record says the account was created, which provider created
// it, and where its first device was last seen from. It never invents a
// channel, a referrer or a campaign.
//
// The record's shape is the one `unknownAccountAcquisition` builds in
// `libs/aglyn/src/lib/app-utils/account-acquisition.ts`; a script cannot
// import TypeScript, so the few fields are written out here, and the staff
// card reads every record through `readAccountAcquisition`, which tolerates
// and re-validates whatever it finds.

/** How long after creation a live door may still record an account: skip those. */
export const LIVE_WINDOW_MS = 30 * 60 * 1000

/** A device registry location, `City, Region, CC`, as a geography; null when it names nothing. */
export function parseDeviceLocation(location) {
  if (typeof location !== 'string') return null
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== 'unknown location')
  if (!parts.length) return null
  const last = parts[parts.length - 1]
  const country = /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null
  const rest = country ? parts.slice(0, -1) : parts
  const geo = {
    country,
    region: rest.length > 1 ? rest[rest.length - 1].slice(0, 64) : null,
    city: rest.length ? rest[0].slice(0, 64) : null,
  }
  return geo.country || geo.region || geo.city ? geo : null
}

/** What an auth `UserRecord` can still say about how the account began. */
export function authFacts(userRecord) {
  if (!userRecord) return { createdAtMs: null, provider: null }
  const createdAtMs = Date.parse(userRecord.metadata?.creationTime ?? '')
  const provider = userRecord.providerData?.[0]?.providerId ?? null
  return {
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    provider: typeof provider === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider) ? provider.toLowerCase() : null,
  }
}

/** Whether a stored field already holds a record — anything present counts. */
export function hasRecord(existing) {
  return existing !== undefined && existing !== null
}

/** The unknown record, with what the platform can still say. */
export function unknownRecord({ nowMs, provider = null, geo = null, accountCreatedAt = null }) {
  return {
    v: 1,
    source: 'unknown',
    medium: null,
    campaign: null,
    channel: 'unknown',
    capturedAt: null,
    landing: null,
    referrerHost: null,
    viaHost: null,
    utm: null,
    clickIds: [],
    door: 'unknown',
    provider,
    invitedToOrgId: null,
    geo,
    accountCreatedAt,
    recordedAt: nowMs,
    recordedBy: 'backfill',
  }
}

/**
 * The record to stamp on one account, or null to leave it: it already has
 * one, or it was created so recently that its own sign-up door may still be
 * writing the real thing.
 */
export function planUserAcquisition({ existing, auth, firstDeviceLocation, nowMs }) {
  if (hasRecord(existing)) return null
  const facts = auth ?? { createdAtMs: null, provider: null }
  if (facts.createdAtMs !== null && nowMs - facts.createdAtMs < LIVE_WINDOW_MS) return null
  return unknownRecord({
    nowMs,
    provider: facts.provider,
    geo: parseDeviceLocation(firstDeviceLocation),
    accountCreatedAt: facts.createdAtMs,
  })
}

/**
 * The record to stamp on one workspace, or null to leave it: its creator's
 * record — stored, or planned in this same run — naming whose it is, the
 * same copy `createOrganization` makes for a workspace created today.
 */
export function planOrgAcquisition({ existing, creatorUid, creatorRecord, nowMs }) {
  if (hasRecord(existing)) return null
  const base = creatorRecord && typeof creatorRecord === 'object'
    ? { ...creatorRecord }
    : unknownRecord({ nowMs })
  delete base.copiedFromUid
  return creatorUid ? { ...base, copiedFromUid: creatorUid } : base
}
