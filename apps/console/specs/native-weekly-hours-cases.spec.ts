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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clockLabel,
  formatClockMinutes,
  weeklyHoursFromText,
  weeklyHoursToText,
} from '@aglyn/shared-ui-jsx/utils/weekly-hours'

/**
 * The native apps pick a week of hours from menus, as the console's picker does, and keep the same stored text lines. The
 * conversion is ported to Swift and Kotlin, and both replay `weekly-hours-cases.json`; this holds that file to the
 * TypeScript it was made from, so a change to the console's reading or writing of hours fails here until the file, and with
 * it both ports, is brought along.
 */
const FILE = join(__dirname, '../../../libs/native/screens/weekly-hours-cases.json')
const { cases, clocks } = JSON.parse(readFileSync(FILE, 'utf8')) as {
  cases: Array<{ text: string; week: number[][][]; unread: number[]; canonical: string }>
  clocks: Array<{ minutes: number; clock: string; label: string }>
}

describe('native weekly hours', () => {
  it('read and write hours text the way the console picker does', () => {
    expect(cases.length).toBeGreaterThan(10)
    for (const item of cases) {
      const { hours, unreadLines } = weeklyHoursFromText(item.text)
      expect([item.text, hours.map((day) => day.map((i) => [i.start, i.end]))]).toEqual([
        item.text,
        item.week,
      ])
      expect([item.text, unreadLines]).toEqual([item.text, item.unread])
      expect([item.text, weeklyHoursToText(hours)]).toEqual([item.text, item.canonical])
    }
  })

  it('name a time on a 24-hour clock and on a menu the way the console does', () => {
    for (const item of clocks) {
      expect(formatClockMinutes(item.minutes)).toBe(item.clock)
      expect(clockLabel(item.minutes)).toBe(item.label)
    }
  })
})
