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

import {
  buildConnectReturnFragment,
  parseConnectReturnFragment,
} from './mailbox-api'
import {
  clampDailyCap,
  defaultSendAs,
  formatMinuteOfDay,
  isValidTimezone,
  OUTREACH_DEFAULT_DAILY_CAP,
  OUTREACH_MAX_DAILY_CAP,
  outreachEffectiveDailyCap,
  outreachLastSevenDays,
  outreachLocalDay,
  outreachRampLimit,
  summarizeMailboxHealth,
  validateDailyCap,
  validateDisplayName,
  validateSendWindow,
  verifiedSendAsAddresses,
} from './mailbox-settings'

/**
 * A mailbox's settings rules (AGL-2978) — the ones the panel and the routes
 * both read, so the answers are pinned once here rather than twice.
 */

const DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 8, 1, 12, 0, 0)

describe('the daily cap and the warm-up ramp (AGL-2978)', () => {
  it('starts at 20 and is never set above 50', () => {
    expect(OUTREACH_DEFAULT_DAILY_CAP).toBe(20)
    expect(OUTREACH_MAX_DAILY_CAP).toBe(50)
    expect(validateDailyCap(50)).toBe(50)
    expect(validateDailyCap(1)).toBe(1)
    for (const bad of [0, 51, 2.5, '20', null]) {
      expect(typeof validateDailyCap(bad)).toBe('object')
    }
    expect(clampDailyCap(500)).toBe(50)
    expect(clampDailyCap(undefined)).toBe(20)
  })

  it('ramps 10 in week one, 20 in week two and 30 from week three', () => {
    expect(outreachRampLimit(START, START)).toBe(10)
    expect(outreachRampLimit(START, START + 7 * DAY - 1)).toBe(10)
    expect(outreachRampLimit(START, START + 7 * DAY)).toBe(20)
    expect(outreachRampLimit(START, START + 14 * DAY)).toBe(30)
    expect(outreachRampLimit(START, START + 400 * DAY)).toBe(30)
    expect(outreachRampLimit(null, START)).toBeNull()
  })

  it('sends today at the lower of the cap and the ramp', () => {
    expect(outreachEffectiveDailyCap({ dailyCap: 50, rampStartedAtMs: START }, START + DAY)).toBe(10)
    expect(outreachEffectiveDailyCap({ dailyCap: 20, rampStartedAtMs: START }, START + 20 * DAY)).toBe(20)
    expect(outreachEffectiveDailyCap({ dailyCap: 50, rampStartedAtMs: START }, START + 20 * DAY)).toBe(30)
    expect(outreachEffectiveDailyCap({ dailyCap: 45, rampStartedAtMs: null }, START)).toBe(45)
  })
})

describe('the sending window, timezone and name (AGL-2978)', () => {
  it('accepts days 0–6 once each, sorted, and a start before the end', () => {
    expect(validateSendWindow({ days: [5, 1, 3, 1], startMinute: 480, endMinute: 1080 })).toEqual({
      days: [1, 3, 5],
      startMinute: 480,
      endMinute: 1080,
    })
    expect(validateSendWindow({ days: [0], startMinute: 0, endMinute: 1440 })).toEqual({ days: [0], startMinute: 0, endMinute: 1440 })
  })

  it('refuses no days, a day outside the week, an empty or inverted span and part minutes', () => {
    for (const window of [
      { days: [], startMinute: 0, endMinute: 60 },
      { days: [7], startMinute: 0, endMinute: 60 },
      { days: [1], startMinute: 600, endMinute: 600 },
      { days: [1], startMinute: 700, endMinute: 600 },
      { days: [1], startMinute: 0, endMinute: 1441 },
      { days: [1], startMinute: 0.5, endMinute: 60 },
      null,
    ]) {
      expect([window, 'days' in (validateSendWindow(window) as object)]).toEqual([window, false])
    }
  })

  it('knows IANA timezones and nothing else', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(42)).toBe(false)
  })

  it('takes a one-line display name up to 100 characters, trimmed', () => {
    expect(validateDisplayName('  Avery Rep ')).toBe('Avery Rep')
    expect(typeof validateDisplayName('Avery\nRep')).toBe('object')
    expect(typeof validateDisplayName('x'.repeat(101))).toBe('object')
    expect(formatMinuteOfDay(540)).toBe('9:00')
    expect(formatMinuteOfDay(1050)).toBe('17:30')
  })
})

describe('health over seven local days (AGL-2978)', () => {
  it('reads the day in the mailbox’s own timezone', () => {
    const lateEvening = Date.UTC(2026, 8, 15, 3, 30)
    expect(outreachLocalDay(lateEvening, 'America/Chicago')).toBe('2026-09-14')
    expect(outreachLocalDay(lateEvening, 'UTC')).toBe('2026-09-15')
    expect(outreachLastSevenDays(lateEvening, 'UTC')).toEqual([
      '2026-09-15',
      '2026-09-14',
      '2026-09-13',
      '2026-09-12',
      '2026-09-11',
      '2026-09-10',
      '2026-09-09',
    ])
  })

  it('sums the last seven days and says whether anything was ever sent', () => {
    const now = Date.UTC(2026, 8, 15, 12, 0)
    expect(summarizeMailboxHealth(undefined, 'UTC', now)).toEqual({ sent: 0, bounces: 0, replies: 0, hasSent: false })
    expect(
      summarizeMailboxHealth(
        {
          lastSentAtMs: now - DAY,
          daily: {
            '2026-09-15': { sent: 4, bounces: 1, replies: 0 },
            '2026-09-10': { sent: 6, bounces: 0, replies: 2 },
            '2026-09-01': { sent: 99, bounces: 9, replies: 9 },
          },
        },
        'UTC',
        now,
      ),
    ).toEqual({ sent: 10, bounces: 1, replies: 2, hasSent: true })
    // Sent long ago, nothing this week: zeros, but not "no sends yet".
    expect(summarizeMailboxHealth({ lastSentAtMs: now - 30 * DAY, daily: {} }, 'UTC', now).hasSent).toBe(true)
  })
})

describe('send-as addresses (AGL-2978)', () => {
  it('offers the account’s own address and accepted aliases, never a pending one', () => {
    const addresses = verifiedSendAsAddresses([
      { sendAsEmail: 'Avery@Rep.Example.com', displayName: 'Avery', isPrimary: true, isDefault: false, verificationStatus: null },
      { sendAsEmail: 'sales@rep.example.com', displayName: 'Sales', isPrimary: false, isDefault: true, verificationStatus: 'accepted' },
      { sendAsEmail: 'waiting@rep.example.com', displayName: '', isPrimary: false, isDefault: false, verificationStatus: 'pending' },
      { sendAsEmail: 'avery@rep.example.com', displayName: 'Dup', isPrimary: false, isDefault: false, verificationStatus: 'accepted' },
    ])
    expect(addresses).toEqual([
      { email: 'avery@rep.example.com', displayName: 'Avery', isPrimary: true, isDefault: false },
      { email: 'sales@rep.example.com', displayName: 'Sales', isPrimary: false, isDefault: true },
    ])
    expect(defaultSendAs(addresses, 'avery@rep.example.com')).toBe('sales@rep.example.com')
    expect(defaultSendAs([], 'avery@rep.example.com')).toBe('avery@rep.example.com')
  })
})

describe('the connect return fragment (AGL-2978)', () => {
  it('round-trips a code and its state, including characters a code carries', () => {
    const value = { kind: 'code' as const, code: '4/0AbC-d_e+f/g==', state: 'os1.payload.sig' }
    expect(parseConnectReturnFragment(`#${buildConnectReturnFragment(value)}`)).toEqual(value)
  })

  it('round-trips an error, reads an unknown reason as a Google error, and ignores other fragments', () => {
    expect(parseConnectReturnFragment(buildConnectReturnFragment({ kind: 'error', reason: 'expired' }))).toEqual({
      kind: 'error',
      reason: 'expired',
    })
    expect(parseConnectReturnFragment('outreachConnect=error&reason=anything')).toEqual({ kind: 'error', reason: 'google_error' })
    expect(parseConnectReturnFragment('#section-2')).toBeNull()
    expect(parseConnectReturnFragment('outreachConnect=code&code=only')).toBeNull()
    expect(parseConnectReturnFragment(undefined)).toBeNull()
  })
})
