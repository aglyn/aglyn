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

// The account-acquisition backfill's decisions (AGL-3289).
//
//   node --test tools/scripts/lib/account-acquisition-backfill.test.mjs

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  authFacts,
  LIVE_WINDOW_MS,
  parseDeviceLocation,
  planOrgAcquisition,
  planUserAcquisition,
} from './account-acquisition-backfill.mjs'

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0)
const CREATED = Date.UTC(2026, 7, 1, 9, 0, 0)

describe('an account with no record', () => {
  it('is stamped unknown, with what the auth record and first device can still say', () => {
    const record = planUserAcquisition({
      existing: undefined,
      auth: authFacts({
        metadata: { creationTime: new Date(CREATED).toUTCString() },
        providerData: [{ providerId: 'google.com' }],
      }),
      firstDeviceLocation: 'Sydney, NSW, AU',
      nowMs: NOW,
    })
    assert.equal(record.source, 'unknown')
    assert.equal(record.channel, 'unknown')
    assert.equal(record.capturedAt, null)
    assert.equal(record.door, 'unknown')
    assert.equal(record.provider, 'google.com')
    assert.equal(record.accountCreatedAt, CREATED)
    assert.deepEqual(record.geo, { country: 'AU', region: 'NSW', city: 'Sydney' })
    assert.equal(record.recordedBy, 'backfill')
    assert.equal(record.recordedAt, NOW)
  })

  it('never invents a channel, a referrer, a landing or a campaign', () => {
    const record = planUserAcquisition({ existing: null, auth: null, firstDeviceLocation: null, nowMs: NOW })
    for (const field of ['referrerHost', 'viaHost', 'landing', 'campaign', 'utm', 'medium']) {
      assert.equal(record[field], null, field)
    }
    assert.deepEqual(record.clickIds, [])
    assert.equal(record.geo, null)
  })
})

describe('what the backfill leaves alone', () => {
  it('an account that already has a record — any record', () => {
    assert.equal(planUserAcquisition({ existing: { source: 'g2.com' }, auth: null, nowMs: NOW }), null)
    assert.equal(planUserAcquisition({ existing: { source: 'unknown' }, auth: null, nowMs: NOW }), null)
  })

  it('an account young enough that its own sign-up may still be writing', () => {
    const young = { createdAtMs: NOW - LIVE_WINDOW_MS + 60_000, provider: 'password' }
    assert.equal(planUserAcquisition({ existing: undefined, auth: young, nowMs: NOW }), null)
    const old = { createdAtMs: NOW - LIVE_WINDOW_MS - 60_000, provider: 'password' }
    assert.notEqual(planUserAcquisition({ existing: undefined, auth: old, nowMs: NOW }), null)
  })
})

describe('a workspace', () => {
  it('copies its creator’s record and names the creator', () => {
    const creator = planUserAcquisition({ existing: undefined, auth: null, nowMs: NOW })
    const record = planOrgAcquisition({ existing: undefined, creatorUid: 'uid-1', creatorRecord: creator, nowMs: NOW })
    assert.deepEqual(record, { ...creator, copiedFromUid: 'uid-1' })
  })

  it('carries a captured creator record over unchanged', () => {
    const captured = { v: 1, source: 'g2.com', channel: 'referral', copiedFromUid: 'someone-else' }
    const record = planOrgAcquisition({ existing: undefined, creatorUid: 'uid-2', creatorRecord: captured, nowMs: NOW })
    assert.equal(record.source, 'g2.com')
    assert.equal(record.copiedFromUid, 'uid-2')
  })

  it('is left alone when it already has a record', () => {
    assert.equal(planOrgAcquisition({ existing: { source: 'unknown' }, creatorUid: 'u', creatorRecord: null, nowMs: NOW }), null)
  })
})

describe('reading the device registry and the auth record', () => {
  it('parses the location string the registry keeps', () => {
    assert.deepEqual(parseDeviceLocation('Austin, TX, US'), { country: 'US', region: 'TX', city: 'Austin' })
    assert.deepEqual(parseDeviceLocation('DE'), { country: 'DE', region: null, city: null })
    assert.deepEqual(parseDeviceLocation('Lisbon, PT'), { country: 'PT', region: null, city: 'Lisbon' })
    assert.equal(parseDeviceLocation('Unknown location'), null)
    assert.equal(parseDeviceLocation(''), null)
    assert.equal(parseDeviceLocation(undefined), null)
  })

  it('reads creation time and provider, and refuses a provider that is not one', () => {
    assert.deepEqual(authFacts(null), { createdAtMs: null, provider: null })
    assert.deepEqual(
      authFacts({ metadata: { creationTime: 'not a date' }, providerData: [{ providerId: '<script>' }] }),
      { createdAtMs: null, provider: null },
    )
  })
})
