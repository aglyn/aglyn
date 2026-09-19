/**
 * @jest-environment node
 *
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

import { decideOutreachMailboxHealth, OUTREACH_BOUNCE_RATE_WINDOW_SENDS } from '../engine/mailbox-health'
import type { OutreachMailbox, OutreachRecentSend } from '../model/outreach.types'
import { outreachMailboxHealthInput, outreachSendDigest, withRecentSend } from './mailbox-health-store'

const NOW = Date.UTC(2026, 8, 15, 15, 0)

const mailbox = (health: Partial<OutreachMailbox['health']>): Pick<OutreachMailbox, 'health' | 'timezone'> => ({
  timezone: 'America/Chicago',
  health: {
    sentToday: 0,
    sentOnDay: null,
    bounces: 0,
    replies: 0,
    lastSentAtMs: null,
    lastErrorAtMs: null,
    lastErrorCode: null,
    ...health,
  },
})

describe('what a mailbox’s health is judged on (AGL-2981)', () => {
  it('names a send by a digest of its Message-ID, never by its recipient', () => {
    const digest = outreachSendDigest('<abc@example.com>')
    expect(digest).toMatch(/^[0-9a-f]{16}$/)
    expect(outreachSendDigest(' <abc@example.com> ')).toBe(digest)
    expect(digest).not.toContain('example')
  })

  it('keeps the last fifty sends, newest last, one entry per send', () => {
    let recent: OutreachRecentSend[] = []
    for (let n = 0; n < OUTREACH_BOUNCE_RATE_WINDOW_SENDS + 5; n += 1) {
      recent = withRecentSend(recent, { id: `s${n}`, atMs: n, bounced: false })
    }
    expect(recent).toHaveLength(OUTREACH_BOUNCE_RATE_WINDOW_SENDS)
    expect(recent[0].id).toBe('s5')
    expect(recent.at(-1)?.id).toBe(`s${OUTREACH_BOUNCE_RATE_WINDOW_SENDS + 4}`)
    // The same send recorded twice — a recovered claim — is one entry.
    expect(withRecentSend(recent, { id: 's9', atMs: 99, bounced: false }).filter((send) => send.id === 's9')).toHaveLength(1)
  })

  it('reads the engine’s inputs off the mailbox as stored, in its own day', () => {
    const input = outreachMailboxHealthInput(
      mailbox({
        daily: { '2026-09-15': { sent: 4, bounces: 2, replies: 1 }, '2026-09-14': { sent: 9, bounces: 5, replies: 0 } },
        recentSends: [
          { id: 'a', atMs: 1, bounced: true },
          { id: 'b', atMs: 2, bounced: false },
          { id: 'c', atMs: 3, bounced: true },
        ],
        lastComplaintAtMs: NOW - 1000,
      }),
      NOW,
    )
    expect(input).toEqual({
      bouncesToday: 2,
      recentSends: 3,
      recentHardBounces: 2,
      lastComplaintAtMs: NOW - 1000,
      nowMs: NOW,
    })
    expect(decideOutreachMailboxHealth(input)).toMatchObject({ pause: true, reason: 'bounces_today' })
  })

  it('reads a mailbox that never sent as healthy', () => {
    const input = outreachMailboxHealthInput(mailbox({}), NOW)
    expect(input).toEqual({ bouncesToday: 0, recentSends: 0, recentHardBounces: 0, lastComplaintAtMs: null, nowMs: NOW })
    expect(decideOutreachMailboxHealth(input).pause).toBe(false)
  })
})
