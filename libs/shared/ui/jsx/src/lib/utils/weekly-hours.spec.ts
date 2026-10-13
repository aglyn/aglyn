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

import { emptyWeeklyHours, weeklyHoursFromText, weeklyHoursToText } from './weekly-hours'

const nineToFive = { start: 540, end: 1020 }

describe('weekly hours text', () => {
  it('reads every day form the hours lines accept', () => {
    const { hours, unreadLines } = weeklyHoursFromText(
      'Mo-Fr 09:00-17:00\nSaturday 10:00-14:00\nFr-Mo 20:00-23:00\nnonsense',
    )
    expect(unreadLines).toEqual([4])
    expect(hours[1]).toEqual([nineToFive, { start: 1200, end: 1380 }])
    expect(hours[3]).toEqual([nineToFive])
    expect(hours[6]).toEqual([{ start: 600, end: 840 }, { start: 1200, end: 1380 }])
    expect(hours[0]).toEqual([{ start: 1200, end: 1380 }])
  })

  it('writes days that share hours together, Monday first', () => {
    const hours = emptyWeeklyHours()
    for (const day of [1, 2, 3, 4, 5]) hours[day] = [{ start: 540, end: 720 }, { start: 780, end: 1020 }]
    hours[6] = [{ start: 600, end: 840 }]
    hours[0] = [{ start: 600, end: 840 }]
    expect(weeklyHoursToText(hours)).toBe(
      'Mo-Fr 09:00-12:00\nMo-Fr 13:00-17:00\nSa,Su 10:00-14:00',
    )
  })

  it('lists days that are not a run', () => {
    const hours = emptyWeeklyHours()
    for (const day of [1, 3, 5]) hours[day] = [nineToFive]
    expect(weeklyHoursToText(hours)).toBe('Mo,We,Fr 09:00-17:00')
  })

  it('round-trips what it writes', () => {
    const text = 'Mo-We,Fr 08:30-16:45\nSa 22:00-02:00'
    expect(weeklyHoursToText(weeklyHoursFromText(text).hours)).toBe(text)
  })

  it('writes nothing for a closed week', () => {
    expect(weeklyHoursToText(emptyWeeklyHours())).toBe('')
  })
})
