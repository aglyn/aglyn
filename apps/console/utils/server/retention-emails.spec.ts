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
 * The getting-started rules (AGL-3692): which email an account is owed, once
 * per crossing, and silence the moment the person does the thing.
 */

import {
  DAY_MS,
  HOUR_MS,
  isRetentionCandidate,
  planRetentionEmail,
  summarizePages,
  type RetentionFacts,
} from './retention-emails'

const NOW = Date.parse('2026-10-08T20:00:00Z')

function facts(overrides: Partial<RetentionFacts>): RetentionFacts {
  return {
    nowMs: NOW,
    createdAtMs: NOW - 2 * HOUR_MS,
    lastSeenMs: NOW - 2 * HOUR_MS,
    emailVerified: true,
    declinedProductEmail: false,
    sent: {},
    ownPages: 0,
    unpublishedEdits: false,
    lastEditMs: null,
    lastOwnPublishMs: null,
    ...overrides,
  }
}

describe('planRetentionEmail — an unconfirmed account', () => {
  it('waits the first hour', () => {
    expect(planRetentionEmail(facts({ emailVerified: false, createdAtMs: NOW - 30 * 60_000 }))).toBeNull()
  })

  it('reminds at an hour, then at a day, each once', () => {
    const hour = facts({ emailVerified: false, createdAtMs: NOW - 2 * HOUR_MS })
    expect(planRetentionEmail(hour)).toEqual({ key: 'retention-verify-reminder', crossing: 'verify-1h' })
    expect(planRetentionEmail({ ...hour, sent: { 'verify-1h': NOW } })).toBeNull()

    const day = facts({ emailVerified: false, createdAtMs: NOW - 30 * HOUR_MS, sent: { 'verify-1h': NOW } })
    expect(planRetentionEmail(day)).toEqual({ key: 'retention-verify-reminder', crossing: 'verify-24h' })
    expect(planRetentionEmail({ ...day, sent: { 'verify-1h': 1, 'verify-24h': 1 } })).toBeNull()
  })

  it('never sends the hour reminder late, past the day mark', () => {
    const late = facts({ emailVerified: false, createdAtMs: NOW - 30 * HOUR_MS })
    expect(planRetentionEmail(late)?.crossing).toBe('verify-24h')
  })

  it('stops after a week', () => {
    expect(planRetentionEmail(facts({ emailVerified: false, createdAtMs: NOW - 8 * DAY_MS }))).toBeNull()
  })

  it('is account mail: a No to product email does not stop it', () => {
    const declined = facts({ emailVerified: false, declinedProductEmail: true })
    expect(planRetentionEmail(declined)?.key).toBe('retention-verify-reminder')
  })
})

describe('planRetentionEmail — nothing built yet', () => {
  const stalled = facts({ createdAtMs: NOW - 30 * HOUR_MS, lastSeenMs: NOW - 29 * HOUR_MS })

  it('nudges at a day, then at three days', () => {
    expect(planRetentionEmail(stalled)).toEqual({ key: 'retention-build-site', crossing: 'build-24h' })
    const later = { ...stalled, createdAtMs: NOW - 4 * DAY_MS, sent: { 'build-24h': 1 } }
    expect(planRetentionEmail(later)).toEqual({ key: 'retention-build-site', crossing: 'build-3d' })
    expect(planRetentionEmail({ ...later, sent: { 'build-24h': 1, 'build-3d': 1 } })).toBeNull()
  })

  it('stops once a page of their own exists', () => {
    expect(planRetentionEmail({ ...stalled, ownPages: 1, unpublishedEdits: true, lastEditMs: NOW - HOUR_MS * 2 })).toBeNull()
  })

  it('never reaches someone who said No to product email', () => {
    expect(planRetentionEmail({ ...stalled, declinedProductEmail: true })).toBeNull()
  })

  it('holds off while the person is in the console right now', () => {
    expect(planRetentionEmail({ ...stalled, lastSeenMs: NOW - 10 * 60_000 })).toBeNull()
  })
})

describe('planRetentionEmail — built, not published', () => {
  const edited = facts({
    createdAtMs: NOW - 3 * DAY_MS,
    lastSeenMs: NOW - 2 * DAY_MS,
    ownPages: 2,
    unpublishedEdits: true,
    lastEditMs: NOW - 2 * DAY_MS,
  })

  it('reminds once, a day after the last edit', () => {
    expect(planRetentionEmail(edited)).toEqual({ key: 'retention-publish-reminder', crossing: 'publish' })
    expect(planRetentionEmail({ ...edited, lastEditMs: NOW - 3 * HOUR_MS, lastSeenMs: NOW - 3 * HOUR_MS })).toBeNull()
    expect(planRetentionEmail({ ...edited, sent: { publish: 1 } })).toBeNull()
  })
})

describe('planRetentionEmail — published', () => {
  it('sends next steps once, while the publish is news', () => {
    const live = facts({ createdAtMs: NOW - 2 * DAY_MS, ownPages: 3, lastOwnPublishMs: NOW - 5 * HOUR_MS })
    expect(planRetentionEmail(live)).toEqual({ key: 'retention-next-steps', crossing: 'next-steps' })
    expect(planRetentionEmail({ ...live, sent: { 'next-steps': 1 } })).toBeNull()
    expect(planRetentionEmail({ ...live, lastOwnPublishMs: NOW - 10 * DAY_MS })).toBeNull()
  })
})

describe('planRetentionEmail — gone quiet', () => {
  const quiet = facts({
    createdAtMs: NOW - 20 * DAY_MS,
    lastSeenMs: NOW - 8 * DAY_MS,
    ownPages: 3,
    lastOwnPublishMs: NOW - 9 * DAY_MS,
    sent: { 'next-steps': 1 },
  })

  it('nudges at a week and at two, once per quiet spell', () => {
    const week = planRetentionEmail(quiet)
    expect(week).toEqual({ key: 'retention-idle', crossing: 'idle-7d:2026-09-30' })
    expect(planRetentionEmail({ ...quiet, sent: { ...quiet.sent, [week!.crossing]: 1 } })).toBeNull()

    const fortnight = planRetentionEmail({ ...quiet, lastSeenMs: NOW - 15 * DAY_MS })
    expect(fortnight?.crossing).toBe('idle-14d:2026-09-23')
  })

  it('re-arms after the person comes back', () => {
    const sentBefore = { ...quiet.sent, 'idle-7d:2026-09-30': 1 }
    const again = planRetentionEmail({ ...quiet, sent: sentBefore, lastSeenMs: NOW - 7 * DAY_MS })
    expect(again?.crossing).toBe('idle-7d:2026-10-01')
  })

  it('never nudges an account that never built anything as idle', () => {
    expect(planRetentionEmail({ ...quiet, ownPages: 0, lastOwnPublishMs: null })).toBeNull()
  })
})

describe('isRetentionCandidate', () => {
  it('reads Firestore only for accounts a rule could reach', () => {
    expect(isRetentionCandidate({ nowMs: NOW, createdAtMs: NOW - 10 * 60_000, lastSeenMs: null, emailVerified: false })).toBe(false)
    expect(isRetentionCandidate({ nowMs: NOW, createdAtMs: NOW - 2 * HOUR_MS, lastSeenMs: null, emailVerified: false })).toBe(true)
    expect(isRetentionCandidate({ nowMs: NOW, createdAtMs: NOW - 90 * DAY_MS, lastSeenMs: NOW - DAY_MS, emailVerified: true })).toBe(false)
    expect(isRetentionCandidate({ nowMs: NOW, createdAtMs: NOW - 90 * DAY_MS, lastSeenMs: NOW - 9 * DAY_MS, emailVerified: true })).toBe(true)
  })
})

describe('summarizePages', () => {
  const created = NOW - 3 * DAY_MS

  it('does not count untouched starter pages, even published ones', () => {
    expect(
      summarizePages([
        { createdAtMs: created, updatedAtMs: created, publishedAtMs: created, createdBy: null, deleted: false },
      ]),
    ).toEqual({ ownPages: 0, unpublishedEdits: false, lastEditMs: null, lastOwnPublishMs: null })
  })

  it('counts an edited starter page as theirs, unpublished until it is published again', () => {
    const edited = { createdAtMs: created, updatedAtMs: NOW - DAY_MS, publishedAtMs: created, createdBy: null, deleted: false }
    expect(summarizePages([edited])).toMatchObject({ ownPages: 1, unpublishedEdits: true, lastOwnPublishMs: null })
    expect(summarizePages([{ ...edited, publishedAtMs: NOW - DAY_MS + 5_000 }])).toMatchObject({
      ownPages: 1,
      unpublishedEdits: false,
      lastOwnPublishMs: NOW - DAY_MS + 5_000,
    })
  })

  it('ignores deleted pages', () => {
    expect(
      summarizePages([{ createdAtMs: created, updatedAtMs: NOW, publishedAtMs: null, createdBy: 'u', deleted: true }]).ownPages,
    ).toBe(0)
  })
})
