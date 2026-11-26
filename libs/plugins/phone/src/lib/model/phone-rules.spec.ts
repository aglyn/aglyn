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
  defaultPhoneSettings,
  fillPhoneTemplate,
  formatPhoneForDisplay,
  inboundKeyword,
  isOpenAt,
  missingComplianceFields,
  phoneE164,
  phoneThreadId,
  sanitizePhoneSettings,
} from './phone-rules'

describe('phone rules (AGL-4251)', () => {
  it('reads North American numbers typed any way as E.164', () => {
    expect(phoneE164('(830) 555-0142')).toBe('+18305550142')
    expect(phoneE164('1-830-555-0142')).toBe('+18305550142')
    expect(phoneE164('+44 20 7946 0958')).toBe('+442079460958')
    expect(phoneE164('call me')).toBeNull()
    expect(formatPhoneForDisplay('+18305550142')).toBe('(830) 555-0142')
  })

  it('keys one thread per pair of numbers, as a plain path segment', () => {
    expect(phoneThreadId('+18305550100', '+18305550142')).toBe('18305550100_18305550142')
  })

  it('is always open with no hours, and follows hours in the business time zone', () => {
    const settings = { timeZone: 'America/Chicago', hours: [] as Array<{ day: number; openMinute: number; closeMinute: number }> }
    expect(isOpenAt(settings, Date.UTC(2026, 10, 26, 8, 0))).toBe(true)
    settings.hours = [{ day: 4, openMinute: 9 * 60, closeMinute: 17 * 60 }]
    // Thursday 2026-11-26 10:00 in Chicago is 16:00 UTC.
    expect(isOpenAt(settings, Date.UTC(2026, 10, 26, 16, 0))).toBe(true)
    // 18:00 Chicago.
    expect(isOpenAt(settings, Date.UTC(2026, 10, 27, 0, 0))).toBe(false)
  })

  it('handles hours that run past midnight', () => {
    const settings = { timeZone: 'UTC', hours: [{ day: 5, openMinute: 20 * 60, closeMinute: 2 * 60 }] }
    // Friday 2026-11-27 23:00 and Saturday 01:00.
    expect(isOpenAt(settings, Date.UTC(2026, 10, 27, 23, 0))).toBe(true)
    expect(isOpenAt(settings, Date.UTC(2026, 10, 28, 1, 0))).toBe(true)
    expect(isOpenAt(settings, Date.UTC(2026, 10, 28, 3, 0))).toBe(false)
  })

  it('fills only the placeholders it knows and never sends a brace', () => {
    expect(fillPhoneTemplate('Book at {siteLink} — {businessName}', { siteLink: 'https://x.aglyn.app/', businessName: 'Ranch' })).toBe(
      'Book at https://x.aglyn.app/ — Ranch',
    )
    expect(fillPhoneTemplate('See {siteLink}', {})).toBe('See')
  })

  it('clamps settings a request sends', () => {
    const current = defaultPhoneSettings(1)
    const next = sanitizePhoneSettings(
      {
        hours: [{ day: 9, openMinute: 0, closeMinute: 10 }, { day: 1, openMinute: 540, closeMinute: 1020 }],
        forwardTo: ['830 555 0142', 'nope', '830-555-0142'],
        ringSeconds: 500,
        ringDuringHours: 'everyone',
        timeZone: 'Mars/Olympus',
      },
      current,
      2,
    )
    expect(next.hours).toEqual([{ day: 1, openMinute: 540, closeMinute: 1020 }])
    expect(next.forwardTo).toEqual(['+18305550142'])
    expect(next.ringSeconds).toBe(60)
    expect(next.ringDuringHours).toBe(current.ringDuringHours)
    expect(next.timeZone).toBe(current.timeZone)
    expect(next.updatedAtMs).toBe(2)
  })

  it('names what a texting registration still needs', () => {
    expect(missingComplianceFields({ businessType: 'sole-proprietor' })).not.toContain('EIN')
    expect(missingComplianceFields({ businessType: 'llc' })).toContain('EIN')
    expect(missingComplianceFields({ sampleMessages: ['one'] })).toContain('Two example texts')
  })

  it('reads STOP and START words', () => {
    expect(inboundKeyword(' Stop ')).toBe('stop')
    expect(inboundKeyword('UNSUBSCRIBE')).toBe('stop')
    expect(inboundKeyword('start')).toBe('start')
    expect(inboundKeyword('stop by tomorrow?')).toBeNull()
  })
})
