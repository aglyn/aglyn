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
 *
 * @jest-environment node
 */

import {
  decideOutreachMailboxHealth,
  OUTREACH_BOUNCE_RATE_MIN_SENDS,
  OUTREACH_COMPLAINT_PAUSE_MS,
  type OutreachMailboxHealthInput,
} from './mailbox-health'

const NOW = Date.parse('2026-09-15T15:00:00Z')

const health = (overrides: Partial<OutreachMailboxHealthInput> = {}) =>
  decideOutreachMailboxHealth({
    bouncesToday: 0,
    recentSends: 50,
    recentHardBounces: 0,
    lastComplaintAtMs: null,
    nowMs: NOW,
    ...overrides,
  })

describe('decideOutreachMailboxHealth', () => {
  it('keeps a clean mailbox sending', () => {
    expect(health()).toEqual({ pause: false, reason: null, message: null, pausedUntilMs: null })
  })

  it('pauses at two hard bounces in one day', () => {
    expect(health({ bouncesToday: 1, recentHardBounces: 1 }).pause).toBe(false)
    expect(health({ bouncesToday: 2, recentSends: 200, recentHardBounces: 0 })).toEqual({
      pause: true,
      reason: 'bounces_today',
      message: 'Paused after 2 hard bounces today. Re-check the addresses in your sequences before resuming.',
      pausedUntilMs: null,
    })
  })

  it('pauses at three hard bounces in the last 50 sends, and no longer on two (AGL-3326)', () => {
    // A bounce two days ago plus one today was 4% of fifty, and paused a
    // mailbox on history the daily rule had already let pass.
    expect(health({ recentSends: 50, recentHardBounces: 1 }).pause).toBe(false)
    expect(health({ recentSends: 50, recentHardBounces: 2 }).pause).toBe(false)
    expect(health({ recentSends: 50, recentHardBounces: 3 })).toEqual({
      pause: true,
      reason: 'bounces_in_window',
      message: 'Paused: 3 of the last 50 emails hard-bounced. Re-check the addresses in your sequences before resuming.',
      pausedUntilMs: null,
    })
  })

  it('takes the count over at most 50 sends', () => {
    // A caller that counted a longer history is held to the window it was asked for.
    expect(health({ recentSends: 400, recentHardBounces: 3 })).toMatchObject({ pause: true, reason: 'bounces_in_window' })
  })

  it('judges the window only once it holds 25 sends (AGL-3244)', () => {
    // Under the floor the daily rule alone judges a young mailbox.
    expect(health({ recentSends: 21, recentHardBounces: 3 }).pause).toBe(false)
    expect(health({ recentSends: OUTREACH_BOUNCE_RATE_MIN_SENDS - 1, recentHardBounces: 3 }).pause).toBe(false)
    expect(health({ recentSends: OUTREACH_BOUNCE_RATE_MIN_SENDS, recentHardBounces: 3 })).toMatchObject({
      pause: true,
      reason: 'bounces_in_window',
      message: expect.stringContaining('3 of the last 25 emails hard-bounced'),
    })
    expect(health({ recentSends: 34, recentHardBounces: 2 }).pause).toBe(false)
    expect(health({ recentSends: 0, recentHardBounces: 0 }).pause).toBe(false)
  })

  it('still pauses a young mailbox on its second bounce of the day', () => {
    expect(health({ bouncesToday: 2, recentSends: 3, recentHardBounces: 2 })).toMatchObject({
      pause: true,
      reason: 'bounces_today',
    })
  })

  it('pauses for a week after a reply called an email spam', () => {
    const complaintAt = NOW - 2 * 24 * 60 * 60 * 1000
    expect(health({ lastComplaintAtMs: complaintAt })).toEqual({
      pause: true,
      reason: 'complaint',
      message: 'Paused for a week after a reply called an email spam. Review who your sequences are reaching.',
      pausedUntilMs: complaintAt + OUTREACH_COMPLAINT_PAUSE_MS,
    })
    expect(health({ lastComplaintAtMs: NOW - OUTREACH_COMPLAINT_PAUSE_MS }).pause).toBe(false)
  })

  it('reads counts that are not counts as nothing', () => {
    expect(health({ bouncesToday: Number.NaN, recentSends: -5, recentHardBounces: 9 }).pause).toBe(false)
    expect(health({ bouncesToday: 2.9 as number }).reason).toBe('bounces_today')
  })
})
