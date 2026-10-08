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
 * A site entity that is a LOCAL BUSINESS (AGL-3383).
 *
 * `host.seo.entity.type` answers Organization or Person and keeps answering
 * it: it is a numeric enum stored as `"1"`/`"2"`, read by the author editor,
 * the logo card and the AI audit, and a third value there would be a third
 * value each of them has to learn. A plumber is still an Organization — the
 * business type REFINES that answer rather than replacing it — so it is a
 * field of its own, `businessType`, holding the `schema.org` subtype name.
 *
 * Every value is checked against {@link LOCAL_BUSINESS_TYPES}, which the
 * console's Select is built from too. A stored value outside it (a typo, a
 * type removed from the list) publishes the plain Organization it would have
 * published before the field existed, rather than an `@type` no consumer
 * recognizes.
 */

/** The `schema.org` LocalBusiness subtypes a site can declare, with their console labels. */
export const LOCAL_BUSINESS_TYPES = [
  { value: 'LocalBusiness', label: 'Local business (general)' },
  { value: 'HomeAndConstructionBusiness', label: 'Home and construction' },
  { value: 'GeneralContractor', label: 'General contractor' },
  { value: 'HousePainter', label: 'House painter' },
  { value: 'Plumber', label: 'Plumber' },
  { value: 'Electrician', label: 'Electrician' },
  { value: 'HVACBusiness', label: 'Heating and air (HVAC)' },
  { value: 'Locksmith', label: 'Locksmith' },
  { value: 'RoofingContractor', label: 'Roofing contractor' },
  { value: 'MovingCompany', label: 'Moving company' },
  { value: 'ProfessionalService', label: 'Professional service' },
  { value: 'Store', label: 'Store' },
  { value: 'FoodEstablishment', label: 'Food and drink' },
  { value: 'Restaurant', label: 'Restaurant' },
  { value: 'HealthAndBeautyBusiness', label: 'Health and beauty' },
  { value: 'MedicalBusiness', label: 'Medical practice' },
  { value: 'Dentist', label: 'Dentist' },
  { value: 'AutomotiveBusiness', label: 'Automotive' },
  { value: 'LegalService', label: 'Legal service' },
  { value: 'AccountingService', label: 'Accounting' },
  { value: 'RealEstateAgent', label: 'Real estate agent' },
  { value: 'SportsActivityLocation', label: 'Gym, sports or fitness' },
  { value: 'ChildCare', label: 'Child care' },
  { value: 'AnimalShelter', label: 'Animal shelter' },
] as const

export type LocalBusinessType = (typeof LOCAL_BUSINESS_TYPES)[number]['value']

/**
 * {@link LOCAL_BUSINESS_TYPES} as a plain list, for readers that cannot read
 * a literal tuple: the native apps' contracts (AGL-3668).
 */
export const LOCAL_BUSINESS_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  LOCAL_BUSINESS_TYPES

/** At most this many areas are published; a service area is a list, not a gazetteer. */
export const AREA_SERVED_MAX = 20
export const AREA_SERVED_NAME_MAX_LENGTH = 120
/** Seven days, twice over — room for split shifts without inviting a timetable. */
export const OPENING_HOURS_MAX_ROWS = 14
/** Google reads a price range past 100 characters as not being one. */
export const PRICE_RANGE_MAX_LENGTH = 100
export const PAYMENT_ACCEPTED_MAX_LENGTH = 200

/**
 * The stored business type, as the `schema.org` name it publishes under, or
 * `undefined` when there is none or it is not on the list.
 *
 * Case-insensitive, returning the canonical spelling, because `@type` is
 * case-sensitive to every consumer and `plumber` would name nothing.
 */
export function localBusinessType(value: unknown): LocalBusinessType | undefined {
  if (typeof value !== 'string') return undefined
  const wanted = value.trim().toLowerCase()
  if (!wanted) return undefined
  return LOCAL_BUSINESS_TYPES.find((entry) => entry.value.toLowerCase() === wanted)
    ?.value
}

/**
 * The areas a business serves: trimmed, blanks dropped, de-duplicated without
 * regard to case, and capped.
 *
 * Accepts the stored array or a newline-separated string, so a value typed
 * into the console's text box reads the same whichever shape reached the
 * document.
 */
export function normalizeAreaServed(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : []
  const seen = new Set<string>()
  const areas: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const name = item.trim().replace(/\s+/g, ' ').slice(0, AREA_SERVED_NAME_MAX_LENGTH)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    areas.push(name)
    if (areas.length >= AREA_SERVED_MAX) break
  }
  return areas
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export type OpeningHoursDay = (typeof DAYS)[number]

/** One line of opening hours: these days, from `opens` to `closes`. */
export interface OpeningHoursRow {
  days: OpeningHoursDay[]
  /** `HH:MM`, 24-hour. */
  opens: string
  /** `HH:MM`, 24-hour. Earlier than `opens` means the next morning. */
  closes: string
}

/**
 * A day token, by the shortest prefix that is unambiguous — `Mo`, `Mon` and
 * `Monday` all work, which is every way a person abbreviates a weekday. A
 * single letter is refused: `T` and `S` are each two days.
 */
const dayIndex = (token: string): number => {
  const wanted = token.trim().toLowerCase()
  if (wanted.length < 2) return -1
  return DAYS.findIndex((day) => day.toLowerCase().startsWith(wanted))
}

/** `9:00` → `09:00`; anything that is not a real time of day → `''`. */
const clockTime = (hours: string, minutes: string): string => {
  const h = Number(hours)
  const m = Number(minutes)
  if (h > 23 || m > 59) return ''
  return `${String(h).padStart(2, '0')}:${minutes}`
}

const DASH = /\s*[-–—]\s*/
const LINE = /^(.+?)\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/

/** One line, or `null` when any part of it does not read. */
function parseOpeningHoursLine(line: string): OpeningHoursRow | null {
  const match = LINE.exec(line.trim())
  if (!match) return null
  const opens = clockTime(match[2], match[3])
  const closes = clockTime(match[4], match[5])
  if (!opens || !closes) return null
  const days: OpeningHoursDay[] = []
  for (const part of match[1].split(',')) {
    const ends = part.trim().split(DASH)
    if (ends.length > 2) return null
    const from = dayIndex(ends[0])
    const to = dayIndex(ends[ends.length - 1])
    if (from < 0 || to < 0) return null
    // A range may wrap the weekend: `Fr-Mo` is Friday through Monday.
    for (let step = 0; step <= (to - from + 7) % 7; step++) {
      const day = DAYS[(from + step) % 7]
      if (!days.includes(day)) days.push(day)
    }
  }
  return days.length ? { days, opens, closes } : null
}

const hoursLines = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(/\r?\n/) : []

/**
 * Opening hours, one line per set of days, in the syntax `schema.org`'s own
 * `openingHours` text uses: `Mo-Fr 09:00-17:00`, `Sa 10:00-14:00`,
 * `Mo,We,Fr 08:00-12:00`.
 *
 * A text box rather than a repeating group of pickers because it is what the
 * settings forms can hold without a new control, and because it is the form
 * a business already writes its hours in. A line that does not read — a
 * mistyped day, `25:00` — is DROPPED rather than guessed at: a published
 * opening time is a promise a customer drives across town on.
 */
export function parseOpeningHours(value: unknown): OpeningHoursRow[] {
  const rows: OpeningHoursRow[] = []
  for (const line of hoursLines(value)) {
    if (!line.trim()) continue
    const row = parseOpeningHoursLine(line)
    if (row) rows.push(row)
    if (rows.length >= OPENING_HOURS_MAX_ROWS) break
  }
  return rows
}

/**
 * The 1-based numbers of the lines {@link parseOpeningHours} would drop, so
 * the console can say which one before it is saved rather than after it
 * silently fails to publish. Blank lines are not problems.
 */
export function invalidOpeningHoursLines(value: unknown): number[] {
  const invalid: number[] = []
  hoursLines(value).forEach((line, index) => {
    if (line.trim() && !parseOpeningHoursLine(line)) invalid.push(index + 1)
  })
  return invalid
}
