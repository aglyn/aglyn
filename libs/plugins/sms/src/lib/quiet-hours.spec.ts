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

import { quietHoursSendAt, SMS_SCHEDULE_MIN_LEAD_MS } from './quiet-hours'

/** 9 PM to 8 AM local is held for 8 AM local (AGL-3610). */
describe('quietHoursSendAt', () => {
  const CHICAGO = 'America/Chicago'

  it('sends now during the day', () => {
    // 15:00 UTC = 10:00 CDT.
    expect(quietHoursSendAt(Date.UTC(2026, 9, 6, 15), CHICAGO)).toBeNull()
    // 01:59 UTC next day = 20:59 CDT, the last minute before quiet hours.
    expect(quietHoursSendAt(Date.UTC(2026, 9, 7, 1, 59), CHICAGO)).toBeNull()
  })

  it('holds an evening text for the next morning', () => {
    // 03:30 UTC Oct 7 = 22:30 CDT Oct 6 → 08:00 CDT Oct 7 = 13:00 UTC.
    expect(quietHoursSendAt(Date.UTC(2026, 9, 7, 3, 30), CHICAGO)).toBe(
      Date.UTC(2026, 9, 7, 13),
    )
  })

  it('holds a pre-dawn text for the same morning', () => {
    // 08:00 UTC = 03:00 CDT → 13:00 UTC.
    expect(quietHoursSendAt(Date.UTC(2026, 9, 7, 8), CHICAGO)).toBe(
      Date.UTC(2026, 9, 7, 13),
    )
  })

  it('lands on 8 AM local across a daylight-saving change', () => {
    // US clocks fall back on Nov 1 2026. 23:00 CDT Oct 31 (04:00 UTC Nov 1)
    // → 08:00 CST Nov 1 = 14:00 UTC.
    expect(quietHoursSendAt(Date.UTC(2026, 10, 1, 4), CHICAGO)).toBe(
      Date.UTC(2026, 10, 1, 14),
    )
  })

  it('never schedules inside the provider floor', () => {
    // 12:55 UTC = 07:55 CDT: 8 AM is five minutes away, too soon to schedule.
    const now = Date.UTC(2026, 9, 7, 12, 55)
    expect(quietHoursSendAt(now, CHICAGO)).toBe(now + SMS_SCHEDULE_MIN_LEAD_MS)
  })

  it('sends now rather than withhold a text over an unreadable zone', () => {
    expect(quietHoursSendAt(Date.UTC(2026, 9, 7, 8), 'Not/AZone')).toBeNull()
  })
})
