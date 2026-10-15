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

import { isSupportedTimeZone, supportedTimeZones } from './collection-entry-date'
import { TIME_ZONE_CHOICES, timeZoneChoices } from './time-zone-choices'

describe('the time zones the native pickers offer', () => {
  it('offers only zones the workspace route accepts', () => {
    expect(TIME_ZONE_CHOICES.filter((zone) => !isSupportedTimeZone(zone))).toEqual([])
  })

  it('offers each zone once, by name', () => {
    expect(new Set(TIME_ZONE_CHOICES).size).toBe(TIME_ZONE_CHOICES.length)
    expect([...TIME_ZONE_CHOICES].sort()).toEqual([...TIME_ZONE_CHOICES])
  })

  it('is what the console offers, give or take the zones the IANA database has learned or dropped since', () => {
    const consoleList = new Set(supportedTimeZones())
    const missing = TIME_ZONE_CHOICES.filter((zone) => !consoleList.has(zone))
    const learned = [...consoleList].filter((zone) => !TIME_ZONE_CHOICES.includes(zone))
    // Most of the list is the same; a runtime a release newer may differ in a handful of names.
    expect(missing.length + learned.length).toBeLessThan(TIME_ZONE_CHOICES.length * 0.05)
    for (const zone of ['America/Chicago', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland']) {
      expect(TIME_ZONE_CHOICES).toContain(zone)
    }
  })

  it('puts the default first, then every zone with its underscores read as spaces', () => {
    const choices = timeZoneChoices()
    expect(choices[0]).toEqual({ value: '', label: 'UTC (default)' })
    expect(choices).toHaveLength(TIME_ZONE_CHOICES.length + 1)
    expect(choices.find((choice) => choice.value === 'America/New_York')).toEqual({ value: 'America/New_York', label: 'America/New York' })
    expect(choices.find((choice) => choice.value === 'America/Los_Angeles')?.label).toBe('America/Los Angeles')
  })
})
