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

/*==========================================
 * DERIVATIONS — reading a cell as the field it was mapped to, and saying how.
 *
 * Every parser here returns the value AND a record of each thing it did to
 * get there: a date read as day/month/year, a `1.234,56` read with a
 * decimal comma, a `$` read as a currency, a full name split at its last
 * word. Nothing is changed silently. The wizard counts the records by kind,
 * shows samples, and a `flagged` record (a guess that could be wrong — an
 * ambiguous date, a best-effort address) is a warning the person must
 * acknowledge before anything is written.
 *
 * ## Three outcomes
 *
 *  - blank — the cell was empty: `{ blank: true, value: null }`, never a problem.
 *  - read — `{ ok: true, value }`, with zero or more derivations.
 *  - unreadable — `{ ok: false, problem }`: the cell is dropped and reported,
 *    never stored as something it did not say.
 *=========================================*/

import { normalizePhone } from '../foundation/definitions/contact.types'
import type { AglynPostalAddress } from '../foundation/definitions/contact.types'
import type { TransferField } from './resource'

/** What a parser did to a cell. */
export type DerivationKind =
  | 'truncated'
  | 'lowercased'
  | 'extracted'
  | 'dateFormat'
  | 'ambiguousDate'
  | 'twoDigitYear'
  | 'excelSerial'
  | 'timeDropped'
  | 'timeAssumed'
  | 'zoneAssumed'
  | 'epochTime'
  | 'thousandsSeparator'
  | 'decimalComma'
  | 'ambiguousNumber'
  | 'negativeParentheses'
  | 'currencySymbol'
  | 'currencyAssumed'
  | 'rounded'
  | 'percentScaled'
  | 'booleanWord'
  | 'phoneNormalized'
  | 'phoneUnnormalized'
  | 'phoneExtensionDropped'
  | 'urlScheme'
  | 'nameSplit'
  | 'honorificDropped'
  | 'addressSplit'
  | 'listSplit'
  | 'listDeduplicated'

/** One thing a parser did, in words a person can check. */
export interface Derivation {
  kind: DerivationKind
  /** The cell as the file had it. */
  from: string
  /** What it became, as text. */
  to: string
  /** The rule in a sentence: "Read as day/month/year". */
  note: string
  /** A guess that could be wrong; the wizard asks for acknowledgement. */
  flagged: boolean
}

/** Why a cell could not be read. */
export type DeriveProblemCode =
  | 'invalidEmail'
  | 'invalidDate'
  | 'invalidDateTime'
  | 'invalidNumber'
  | 'notInteger'
  | 'invalidCurrency'
  | 'invalidPercent'
  | 'invalidBoolean'
  | 'invalidUrl'
  | 'invalidJson'

export interface DeriveProblem {
  code: DeriveProblemCode
  message: string
}

/** A cell read as a field. */
export interface DerivedValue<T> {
  /** `null` when blank or unreadable. */
  value: T | null
  /** The cell was empty. */
  blank: boolean
  /** The cell was blank or read; `false` means it is dropped. */
  ok: boolean
  derivations: Derivation[]
  problem?: DeriveProblem
}

function blankValue<T>(): DerivedValue<T> {
  return { value: null, blank: true, ok: true, derivations: [] }
}

function readValue<T>(value: T, derivations: Derivation[] = []): DerivedValue<T> {
  return { value, blank: false, ok: true, derivations }
}

function unreadable<T>(code: DeriveProblemCode, message: string): DerivedValue<T> {
  return { value: null, blank: false, ok: false, derivations: [], problem: { code, message } }
}

function derivation(kind: DerivationKind, from: string, to: unknown, note: string, flagged = false): Derivation {
  return { kind, from, to: typeof to === 'string' ? to : JSON.stringify(to), note, flagged }
}

function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? '' : raw.toISOString()
  return String(raw).trim()
}

/*------------------------------------------
 * Text
 *-----------------------------------------*/

/** A text cell, trimmed; capped at `maxLength` with a flagged record when cut. */
export function deriveText(raw: unknown, options: { maxLength?: number; multiline?: boolean } = {}): DerivedValue<string> {
  let text = options.multiline ? String(raw ?? '').replace(/\r\n?/g, '\n').trim() : cellText(raw)
  if (!options.multiline) text = text.replace(/\s+/g, ' ')
  if (!text) return blankValue()
  if (options.maxLength && text.length > options.maxLength) {
    const cut = text.slice(0, options.maxLength)
    return readValue(cut, [
      derivation('truncated', text, cut, `Cut to ${options.maxLength} characters`, true),
    ])
  }
  return readValue(text)
}

/*------------------------------------------
 * Boolean
 *-----------------------------------------*/

const TRUE_WORDS = ['yes', 'y', 'true', '1', 'on', 'subscribed', 'opted in', 'opted-in']
const FALSE_WORDS = ['no', 'n', 'false', '0', 'off', 'unsubscribed', '']

/**
 * A yes/no cell as a boolean, or `null` when it is neither.
 *
 * The affirmatives are the ones consent and checkbox columns actually
 * carry; the negatives are listed so that an explicit `no` is a `false`
 * rather than an unreadable value that gets reported as dropped. An empty
 * cell reads as `false`, which is what a checkbox column means by it.
 */
export function parseImportFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (TRUE_WORDS.includes(text)) return true
  if (FALSE_WORDS.includes(text)) return false
  return null
}

/** A boolean cell; a word other than true/false is recorded. */
export function deriveBoolean(raw: unknown): DerivedValue<boolean> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const flag = parseImportFlag(typeof raw === 'string' ? text : raw)
  if (flag === null) return unreadable('invalidBoolean', `"${text}" is not a yes or a no.`)
  const plain = text.toLowerCase() === String(flag)
  return readValue(flag, plain ? [] : [derivation('booleanWord', text, String(flag), `Read "${text}" as ${flag ? 'yes' : 'no'}`)])
}

/*------------------------------------------
 * Email, phone, URL
 *-----------------------------------------*/

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/

/** An address cell: `mailto:` and a display name stripped, lowercased, checked. */
export function deriveEmail(raw: unknown): DerivedValue<string> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  let address = text
  const angled = /<([^<>]+)>\s*$/.exec(address)
  if (angled?.[1]) {
    address = angled[1].trim()
    derivations.push(derivation('extracted', text, address, 'Took the address out of a name and address'))
  }
  if (/^mailto:/i.test(address)) {
    const stripped = address.replace(/^mailto:/i, '').split('?')[0] ?? ''
    derivations.push(derivation('extracted', address, stripped, 'Removed "mailto:"'))
    address = stripped
  }
  const lower = address.toLowerCase()
  if (lower !== address) derivations.push(derivation('lowercased', address, lower, 'Lowercased the address'))
  if (!EMAIL.test(lower)) return unreadable('invalidEmail', `"${text}" is not an email address.`)
  return readValue(lower, derivations)
}

const EXTENSION = /\s*(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i

/**
 * A phone cell in E.164 through the platform's `normalizePhone`. A number it
 * cannot normalize confidently is kept as typed and flagged — dropping a
 * real number is worse than storing it unformatted. An extension is
 * removed (E.164 has no place for it) and flagged.
 */
export function derivePhone(raw: unknown, options: { defaultCountry?: string } = {}): DerivedValue<string> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  let number = text
  const extension = EXTENSION.exec(number)
  if (extension && number.replace(EXTENSION, '').replace(/\D/g, '').length >= 7) {
    const without = number.replace(EXTENSION, '').trim()
    derivations.push(
      derivation('phoneExtensionDropped', text, without, `Dropped extension ${extension[1]}`, true),
    )
    number = without
  }
  const normalized = normalizePhone(number, options.defaultCountry ?? 'US')
  if (!normalized) {
    derivations.push(
      derivation('phoneUnnormalized', text, number, 'Kept as typed: no country code to read it by', true),
    )
    return readValue(number, derivations)
  }
  if (normalized !== number) {
    derivations.push(derivation('phoneNormalized', number, normalized, 'Written in international format'))
  }
  return readValue(normalized, derivations)
}

/** A web address cell: `https://` added to a bare domain, host lowercased, checked. */
export function deriveUrl(raw: unknown): DerivedValue<string> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  let candidate = text
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(candidate)) {
      return unreadable('invalidUrl', `"${text}" is not a web address.`)
    }
    candidate = `https://${candidate}`
    derivations.push(derivation('urlScheme', text, candidate, 'Added https://'))
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return unreadable('invalidUrl', `"${text}" is not a web address.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return unreadable('invalidUrl', `"${text}" is not a web address.`)
  }
  const rest = candidate.slice(candidate.indexOf('//') + 2).replace(/^[^/?#]*/, '')
  return readValue(`${url.protocol}//${url.host}${rest}`, derivations)
}

/*------------------------------------------
 * Dates and times
 *-----------------------------------------*/

/** How an all-number date's day and month are told apart. */
export interface DateOptions {
  /** Fixed by the person, or `auto` to read it from the values. */
  order?: 'auto' | 'mdy' | 'dmy'
  /** The order an ambiguous date is read in under `auto`; default `mdy`. */
  preferredOrder?: 'mdy' | 'dmy'
  /** Read a bare five-digit number as a spreadsheet serial day; default true. */
  excelSerials?: boolean
  /** Two-digit years below this are 20xx, the rest 19xx; default 50. */
  twoDigitYearPivot?: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthOf(word: string): number | null {
  const key = word.toLowerCase().slice(0, 3)
  const at = MONTHS.indexOf(key)
  if (at < 0) return null
  // `sept` and full names are fine; a word that only starts like a month is not.
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const lower = word.toLowerCase()
  return full[at]?.startsWith(lower) ? at + 1 : null
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null
  if (month < 1 || month > 12 || day < 1) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCFullYear(year)
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** The spreadsheet epoch: serial day 0 is 1899-12-30 (the leap-year bug folded in). */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

function serialToDate(serial: number): Date {
  return new Date(SERIAL_EPOCH_MS + Math.round(serial * DAY_MS))
}

function fullYear(text: string, pivot: number, from: string, derivations: Derivation[]): number {
  const n = Number(text)
  if (text.length !== 2) return n
  const year = n < pivot ? 2000 + n : 1900 + n
  derivations.push(derivation('twoDigitYear', from, String(year), `Read year "${text}" as ${year}`, true))
  return year
}

/**
 * A date cell as `YYYY-MM-DD`.
 *
 * ISO dates read as they are; `2024/03/05` and `20240305` are read year
 * first; an all-number date with the year last is read by `order`, and
 * under `auto` a value whose day and month could be swapped (`03/05/2024`)
 * is read in `preferredOrder` and flagged; month names read in either
 * order; a bare serial number is a spreadsheet's date.
 */
export function deriveDate(raw: unknown, options: DateOptions = {}): DerivedValue<string> {
  const derivations: Derivation[] = []
  const result = parseDateText(raw, options, derivations)
  if (result === undefined) return blankValue()
  if (result === null) return unreadable('invalidDate', `"${cellText(raw)}" is not a date.`)
  return readValue(result, derivations)
}

function parseDateText(raw: unknown, options: DateOptions, derivations: Derivation[]): string | null | undefined {
  const text = cellText(raw)
  if (!text) return undefined
  const pivot = options.twoDigitYearPivot ?? 50

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.+))?$/.exec(text)
  if (iso) {
    const date = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (date && iso[4]) derivations.push(derivation('timeDropped', text, date, 'Kept the date, dropped the time'))
    return date
  }

  const yearFirst = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (yearFirst) {
    const date = isoDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]))
    if (date) derivations.push(derivation('dateFormat', text, date, 'Read as year/month/day'))
    return date
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (numeric) {
    const a = Number(numeric[1])
    const b = Number(numeric[2])
    const yearDerivations: Derivation[] = []
    const year = fullYear(numeric[3] as string, pivot, text, yearDerivations)
    let order: 'mdy' | 'dmy'
    let ambiguous = false
    if (options.order === 'mdy' || options.order === 'dmy') order = options.order
    else if (a > 12 && b <= 12) order = 'dmy'
    else if (b > 12 && a <= 12) order = 'mdy'
    else if (a > 12 && b > 12) return null
    else {
      order = options.preferredOrder ?? 'mdy'
      ambiguous = a !== b
    }
    const date = order === 'mdy' ? isoDate(year, a, b) : isoDate(year, b, a)
    if (!date) return null
    const words = order === 'mdy' ? 'month/day/year' : 'day/month/year'
    derivations.push(
      ambiguous
        ? derivation('ambiguousDate', text, date, `Could be either order; read as ${words}`, true)
        : derivation('dateFormat', text, date, `Read as ${words}`),
    )
    derivations.push(...yearDerivations)
    return date
  }

  const named =
    /^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{2}|\d{4})$/i.exec(text) ??
    null
  const namedMonthFirst =
    /^(?:[a-z]+,\s+)?([a-z]+)\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2}|\d{4})$/i.exec(text) ?? null
  if (named || namedMonthFirst) {
    const day = Number(named ? named[1] : namedMonthFirst?.[2])
    const month = monthOf((named ? named[2] : namedMonthFirst?.[1]) as string)
    if (!month) return null
    const yearDerivations: Derivation[] = []
    const year = fullYear((named ? named[3] : namedMonthFirst?.[3]) as string, pivot, text, yearDerivations)
    const date = isoDate(year, month, day)
    if (!date) return null
    derivations.push(derivation('dateFormat', text, date, 'Read the month by name'), ...yearDerivations)
    return date
  }

  const serial = typeof raw === 'number' ? raw : /^\d{5}(?:\.\d+)?$/.test(text) ? Number(text) : NaN
  if (options.excelSerials !== false && Number.isFinite(serial) && serial >= 1 && serial <= 2_958_465) {
    const at = serialToDate(serial)
    const date = isoDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
    if (date) derivations.push(derivation('excelSerial', text, date, 'Read as a spreadsheet serial date', true))
    return date
  }
  return null
}

/** How a date and time without a zone is placed. */
export interface DateTimeOptions extends DateOptions {
  /** Minutes east of UTC a zone-less time is read in; default 0 (UTC). */
  offsetMinutes?: number
}

const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i

function zoneLabel(offsetMinutes: number): string {
  if (!offsetMinutes) return 'UTC'
  const sign = offsetMinutes > 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function offsetOf(zone: string): number | null {
  if (/^(?:z|utc|gmt)$/i.test(zone)) return 0
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/**
 * A date-and-time cell as an ISO instant (`…Z`).
 *
 * A time with a zone is exact. A time without one is read in
 * `offsetMinutes` and flagged; a date alone is midnight there. A ten- or
 * thirteen-digit number is a Unix time in seconds or milliseconds, and a
 * serial number with a fraction is a spreadsheet's date and time — both
 * flagged, because a column of numbers could be something else.
 */
export function deriveDateTime(raw: unknown, options: DateTimeOptions = {}): DerivedValue<string> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const fail = (): DerivedValue<string> => unreadable('invalidDateTime', `"${text}" is not a date and time.`)
  const offset = options.offsetMinutes ?? 0

  if (ZONED_ISO.test(text)) {
    const ms = Date.parse(text)
    return Number.isNaN(ms) ? fail() : readValue(new Date(ms).toISOString())
  }

  if (/^\d{10}$|^\d{13}$/.test(text)) {
    const ms = text.length === 10 ? Number(text) * 1000 : Number(text)
    const iso = new Date(ms).toISOString()
    return readValue(iso, [
      derivation('epochTime', text, iso, `Read as a Unix time in ${text.length === 10 ? 'seconds' : 'milliseconds'}`, true),
    ])
  }

  const serial = typeof raw === 'number' ? raw : /^\d{5}\.\d+$/.test(text) ? Number(text) : NaN
  if (options.excelSerials !== false && Number.isFinite(serial) && serial >= 1 && serial <= 2_958_465) {
    const iso = new Date(serialToDate(serial).getTime() - offset * 60_000).toISOString()
    return readValue(iso, [derivation('excelSerial', text, iso, 'Read as a spreadsheet serial date and time', true)])
  }

  const timed =
    /^(.*?)[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap]\.?m\.?)?\s*(z|utc|gmt|[+-]\d{2}:?\d{2})?$/i.exec(text)
  const derivations: Derivation[] = []
  const datePart = timed ? (timed[1] as string) : text
  const date = parseDateText(datePart, options, derivations)
  if (!date) return fail()
  let hours = 0
  let minutes = 0
  let seconds = 0
  let zoneOffset: number | null = null
  if (timed) {
    hours = Number(timed[2])
    minutes = Number(timed[3])
    seconds = Number(timed[4] ?? 0)
    const meridiem = timed[5]?.toLowerCase().replace(/\./g, '')
    if (meridiem) {
      if (hours < 1 || hours > 12) return fail()
      if (meridiem === 'pm' && hours !== 12) hours += 12
      if (meridiem === 'am' && hours === 12) hours = 0
    }
    if (hours > 23 || minutes > 59 || seconds > 59) return fail()
    if (timed[6]) {
      zoneOffset = offsetOf(timed[6])
      if (zoneOffset === null) return fail()
    }
  } else {
    derivations.push(derivation('timeAssumed', text, '00:00', 'No time given; read as midnight'))
  }
  // A date-only cell is a day, not a moment someone was unsure of the zone
  // of — only a cell that HAS a time without a zone is flagged.
  if (zoneOffset === null && timed) {
    derivations.push(derivation('zoneAssumed', text, zoneLabel(offset), `No time zone; read as ${zoneLabel(offset)}`, true))
  }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const local = new Date(Date.UTC(2000, m - 1, d, hours, minutes, seconds))
  // `Date.UTC` reads a year below 100 as 19xx; the year is set on its own.
  local.setUTCFullYear(y, m - 1, d)
  const at = new Date(local.getTime() - (zoneOffset ?? offset) * 60_000)
  return readValue(at.toISOString(), derivations)
}

/*------------------------------------------
 * Numbers, currency, percent
 *-----------------------------------------*/

/** Which character a number's decimal point is. */
export interface NumberOptions {
  /** Fixed by the person, or `auto` to read it from the value; default `auto`. */
  decimal?: 'auto' | '.' | ','
}

const GROUPED_COMMA = /^\d{1,3}(?:,\d{3})+$/
const GROUPED_DOT = /^\d{1,3}(?:\.\d{3})+$/
const PLAIN_NUMBER = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$|^\.\d+$/i

/**
 * A locale-formatted number: separators read, parentheses as a minus.
 * `null` when the text is not a number. Every separator decision is
 * recorded; a lone `1,234` or `1.234` under `auto` could be a thousand or
 * one-and-a-bit, so it is read as the thousand and flagged.
 */
export function parseLocaleNumber(
  text: string,
  options: NumberOptions = {},
  derivations: Derivation[] = [],
): number | null {
  const from = text
  // Spaces (plain, non-breaking, narrow) and apostrophes only ever group thousands.
  let body = text.trim().replace(/[\s\u00a0\u202f'\u2019]+/g, '_')
  let negative = false
  const paren = /^\((.*)\)$/.exec(body)
  if (paren) {
    body = paren[1] as string
    negative = true
    derivations.push(derivation('negativeParentheses', from, `-${body}`, 'Read parentheses as a minus'))
  }
  if (/^[+-]/.test(body)) {
    if (body.startsWith('-')) negative = !negative
    body = body.slice(1)
  } else if (/-$/.test(body)) {
    negative = !negative
    body = body.slice(0, -1)
  }
  if (body.includes('_')) {
    if (!/^\d{1,3}(?:_\d{3})+(?:[.,]\d+)?$/.test(body)) return null
    body = body.replace(/_/g, '')
    derivations.push(derivation('thousandsSeparator', from, body, 'Removed the thousands separators'))
  }
  const decimal = options.decimal ?? 'auto'
  const hasDot = body.includes('.')
  const hasComma = body.includes(',')
  if (hasDot && hasComma) {
    const commaLast = body.lastIndexOf(',') > body.lastIndexOf('.')
    const point = decimal === 'auto' ? (commaLast ? ',' : '.') : decimal
    const group = point === ',' ? '.' : ','
    const [whole, fraction, extra] = body.split(point)
    if (extra !== undefined || !whole || !fraction) return null
    if (!(group === '.' ? GROUPED_DOT : GROUPED_COMMA).test(whole)) return null
    body = `${whole.split(group).join('')}.${fraction}`
    derivations.push(derivation('thousandsSeparator', from, body, `Read "${group}" as the thousands separator`))
    if (point === ',') derivations.push(derivation('decimalComma', from, body, 'Read "," as the decimal point'))
  } else if (hasComma) {
    if (decimal === ',' || (decimal === 'auto' && !GROUPED_COMMA.test(body))) {
      if ((body.match(/,/g) ?? []).length > 1) return null
      body = body.replace(',', '.')
      derivations.push(derivation('decimalComma', from, body, 'Read "," as the decimal point'))
    } else {
      if (!GROUPED_COMMA.test(body)) return null
      const ambiguous = decimal === 'auto' && (body.match(/,/g) ?? []).length === 1
      body = body.replace(/,/g, '')
      derivations.push(
        ambiguous
          ? derivation('ambiguousNumber', from, body, 'Read "," as the thousands separator; it could be a decimal comma', true)
          : derivation('thousandsSeparator', from, body, 'Read "," as the thousands separator'),
      )
    }
  } else if (hasDot) {
    const dots = (body.match(/\./g) ?? []).length
    if (dots > 1 || (decimal === ',' && GROUPED_DOT.test(body))) {
      if (!GROUPED_DOT.test(body)) return null
      body = body.replace(/\./g, '')
      derivations.push(derivation('thousandsSeparator', from, body, 'Read "." as the thousands separator'))
    }
  }
  if (!PLAIN_NUMBER.test(body)) return null
  const value = Number(body)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/** A number cell. */
export function deriveNumber(raw: unknown, options: NumberOptions = {}): DerivedValue<number> {
  if (typeof raw === 'number') return Number.isFinite(raw) ? readValue(raw) : unreadable('invalidNumber', 'Not a number.')
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  const value = parseLocaleNumber(text, options, derivations)
  if (value === null) return unreadable('invalidNumber', `"${text}" is not a number.`)
  return readValue(value, derivations)
}

/** A whole-number cell; a fraction is unreadable rather than rounded away. */
export function deriveInteger(raw: unknown, options: NumberOptions = {}): DerivedValue<number> {
  const result = deriveNumber(raw, options)
  if (!result.ok || result.value === null) return result
  if (!Number.isInteger(result.value)) {
    return unreadable('notInteger', `"${cellText(raw)}" is not a whole number.`)
  }
  return result
}

/** An amount of money in the currency's smallest unit (cents for USD). */
export interface CurrencyAmount {
  amountMinor: number
  /** ISO 4217, uppercase. */
  currency: string
}

/** Currencies whose smallest unit is not the hundredth. */
export const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
  BHD: 3,
  CLP: 0,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
  UGX: 0,
  VND: 0,
  XAF: 0,
  XOF: 0,
}

/** How many decimal places a currency's smallest unit is. */
export function currencyMinorUnits(currency: string): number {
  return CURRENCY_MINOR_UNITS[currency.toUpperCase()] ?? 2
}

/** Symbols longest first, so `US$` is found before `$`. */
const CURRENCY_SYMBOLS: readonly (readonly [string, string | null])[] = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['R$', 'BRL'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['₪', 'ILS'],
  ['₱', 'PHP'],
  ['₫', 'VND'],
  ['₺', 'TRY'],
  ['$', null],
]

const DOLLAR_CURRENCIES = ['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'MXN']

/** What currency a cell is read in when it names none. */
export interface CurrencyOptions extends NumberOptions {
  /** ISO 4217; default `USD`. */
  defaultCurrency?: string
}

/**
 * A money cell as an amount in minor units and a currency. A symbol or a
 * three-letter code on either side names the currency; `$` alone is the
 * default currency when that is a dollar, else US dollars; a bare number
 * is the default currency. More decimals than the currency has are rounded
 * and flagged.
 */
export function deriveCurrency(raw: unknown, options: CurrencyOptions = {}): DerivedValue<CurrencyAmount> {
  const fallback = (options.defaultCurrency ?? 'USD').toUpperCase()
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  let body = text
  let currency: string | null = null
  const coded = /^([a-z]{3})\s*(.+)$/i.exec(body) ?? /^(.+?)\s*([a-z]{3})$/i.exec(body)
  if (coded) {
    const codeFirst = /^[a-z]{3}$/i.test(coded[1] as string) && !/^\d/.test(coded[1] as string)
    const code = (codeFirst ? coded[1] : coded[2]) as string
    if (/^[a-z]{3}$/i.test(code) && !/^e[+-]?\d/i.test(code)) {
      currency = code.toUpperCase()
      body = ((codeFirst ? coded[2] : coded[1]) as string).trim()
    }
  }
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    const at = body.indexOf(symbol)
    if (at < 0) continue
    body = (body.slice(0, at) + body.slice(at + symbol.length)).trim()
    const named = code ?? (DOLLAR_CURRENCIES.includes(fallback) ? fallback : 'USD')
    if (!currency) currency = named
    derivations.push(derivation('currencySymbol', text, currency, `Read "${symbol}" as ${currency}`))
    break
  }
  if (!currency) {
    currency = fallback
    derivations.push(derivation('currencyAssumed', text, currency, `No currency given; read as ${currency}`))
  }
  const value = parseLocaleNumber(body, options, derivations)
  if (value === null) return unreadable('invalidCurrency', `"${text}" is not an amount of money.`)
  const units = currencyMinorUnits(currency)
  const scaled = value * 10 ** units
  const amountMinor = Math.round(scaled)
  if (Math.abs(scaled - amountMinor) > 1e-6) {
    derivations.push(
      derivation('rounded', text, String(amountMinor / 10 ** units), `Rounded to ${units} decimal places`, true),
    )
  }
  return readValue({ amountMinor, currency }, derivations)
}

/** Whether a percent is stored as `12` (whole) or `0.12` (fraction) for 12%. */
export interface PercentOptions extends NumberOptions {
  /** Default `whole`. */
  scale?: 'whole' | 'fraction'
}

/**
 * A percent cell. `12%` is twelve percent. A number with no `%` between 0
 * and 1 (`0.12`) is read as a fraction — twelve percent — and flagged,
 * because a file of fractions and a file of tiny percents look the same.
 */
export function derivePercent(raw: unknown, options: PercentOptions = {}): DerivedValue<number> {
  const text = cellText(raw)
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  const signed = /%\s*$|^\s*%/.test(text)
  const value = parseLocaleNumber(text.replace(/%/g, '').trim(), options, derivations)
  if (value === null) return unreadable('invalidPercent', `"${text}" is not a percent.`)
  let whole = value
  if (!signed && value !== 0 && Math.abs(value) < 1) {
    whole = Number((value * 100).toPrecision(12))
    derivations.push(derivation('percentScaled', text, `${whole}%`, `Read ${text} as a fraction: ${whole}%`, true))
  }
  return readValue(options.scale === 'fraction' ? Number((whole / 100).toPrecision(12)) : whole, derivations)
}

/*------------------------------------------
 * Names, addresses, lists
 *-----------------------------------------*/

/** Which rule split a full name. */
export type NameSplitRule = 'lastCommaFirst' | 'lastWord' | 'surnameParticle' | 'singleWord'

export interface SplitName {
  first: string | null
  last: string | null
  rule: NameSplitRule
}

const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'dame', 'rev']
const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'phd', 'md', 'esq', 'dds', 'cpa']
const PARTICLES = ['van', 'von', 'de', 'der', 'den', 'da', 'das', 'dos', 'del', 'della', 'di', 'du', 'la', 'le', 'bin', 'binti', 'al', 'el', 'ter', 'ten', 'st', 'st.']

function bare(word: string): string {
  return word.toLowerCase().replace(/[.,]/g, '')
}

/**
 * A full name as first and last. "Last, First" splits at the comma; an
 * honorific is dropped (and recorded); a suffix stays with the last name; a
 * surname particle (`van`, `de la`) starts the last name; otherwise the
 * last word is the last name. Every split is recorded with its rule.
 */
export function splitFullName(raw: unknown): DerivedValue<SplitName> {
  const text = cellText(raw).replace(/\s+/g, ' ')
  if (!text) return blankValue()
  const derivations: Derivation[] = []
  const done = (first: string | null, last: string | null, rule: NameSplitRule, note: string): DerivedValue<SplitName> => {
    derivations.push(derivation('nameSplit', text, { first, last }, note))
    return readValue({ first: first || null, last: last || null, rule }, derivations)
  }
  const comma = /^([^,]+),\s*([^,]+)$/.exec(text)
  if (comma && !SUFFIXES.includes(bare(comma[2] as string))) {
    return done((comma[2] as string).trim(), (comma[1] as string).trim(), 'lastCommaFirst', 'Read as "Last, First"')
  }
  let words = text.replace(/,/g, ' ').split(' ').filter(Boolean)
  while (words.length > 1 && HONORIFICS.includes(bare(words[0] as string))) {
    derivations.push(derivation('honorificDropped', text, words[0] as string, `Dropped "${words[0]}"`))
    words = words.slice(1)
  }
  const suffixes: string[] = []
  while (words.length > 2 && SUFFIXES.includes(bare(words[words.length - 1] as string))) {
    suffixes.unshift(words.pop() as string)
  }
  if (words.length === 1) return done(words[0] as string, null, 'singleWord', 'One word; kept as the first name')
  const particleAt = words.findIndex((word, index) => index > 0 && index < words.length - 1 && PARTICLES.includes(word.toLowerCase()))
  const tail = suffixes.length ? ` ${suffixes.join(' ')}` : ''
  if (particleAt > 0) {
    return done(
      words.slice(0, particleAt).join(' '),
      words.slice(particleAt).join(' ') + tail,
      'surnameParticle',
      `Last name starts at "${words[particleAt]}"`,
    )
  }
  return done(
    words.slice(0, -1).join(' '),
    (words[words.length - 1] as string) + tail,
    'lastWord',
    'Last word is the last name',
  )
}

const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  'us': 'US',
  'usa': 'US',
  'u s a': 'US',
  'united states': 'US',
  'united states of america': 'US',
  'america': 'US',
  'ca': 'CA',
  'canada': 'CA',
  'uk': 'GB',
  'gb': 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'ireland': 'IE',
  'australia': 'AU',
  'new zealand': 'NZ',
  'germany': 'DE',
  'deutschland': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'netherlands': 'NL',
  'mexico': 'MX',
  'india': 'IN',
  'japan': 'JP',
  'brazil': 'BR',
}

function countryOf(part: string): string | null {
  const key = part.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim()
  return COUNTRY_NAMES[key] ?? null
}

/**
 * A one-line address as parts, best effort, always flagged: commas split
 * it; a trailing country name becomes its two-letter code; `TX 78701`,
 * a bare postal code or a two-letter region is read from the end; the part
 * before that is the city; the rest is the street.
 */
export function parseAddressLine(raw: unknown): DerivedValue<AglynPostalAddress> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return readValue(raw as AglynPostalAddress)
  }
  const text = cellText(raw).replace(/\s*\n\s*/g, ', ')
  if (!text) return blankValue()
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const address: AglynPostalAddress = {}
  const last = parts[parts.length - 1]
  if (parts.length > 1 && last) {
    const country = countryOf(last)
    if (country) {
      address.country = country
      parts.pop()
    }
  }
  const tail = parts[parts.length - 1]
  if (parts.length > 1 && tail) {
    const regionPostal = /^([A-Za-z][A-Za-z .]{1,30}?)\s+([A-Z0-9]{3,10}(?:[ -][A-Z0-9]{2,5})?)$/i.exec(tail)
    if (regionPostal && /\d/.test(regionPostal[2] as string)) {
      address.state = (regionPostal[1] as string).trim()
      address.postalCode = (regionPostal[2] as string).toUpperCase()
      parts.pop()
    } else if (/^[A-Z0-9]{3,10}(?:[ -][A-Z0-9]{2,5})?$/i.test(tail) && /\d/.test(tail)) {
      address.postalCode = tail.toUpperCase()
      parts.pop()
    } else if (/^[A-Za-z]{2}$/.test(tail) && parts.length > 2) {
      address.state = tail.toUpperCase()
      parts.pop()
    }
  }
  if (parts.length > 1) address.city = parts.pop()
  if (parts.length) address.line1 = parts.join(', ')
  return readValue(address, [
    derivation('addressSplit', text, address, 'Split one line into street, city, region, postal code and country', true),
  ])
}

/** How a list cell is split. */
export interface ListOptions {
  /** Default `,` `;` `|` and line breaks. */
  separators?: RegExp
  /** Lowercase every item (tags). */
  lowercase?: boolean
  /** The most items kept. */
  max?: number
}

/**
 * A list cell as its items: split on `,` `;` `|` or line breaks, trimmed,
 * duplicates (in any case) dropped keeping the first spelling. An array
 * (from a JSON file) is taken item by item.
 */
export function splitTransferList(raw: unknown, options: ListOptions = {}): DerivedValue<string[]> {
  const parts = Array.isArray(raw)
    ? raw.map((item) => cellText(item))
    : cellText(raw).split(options.separators ?? /[,;|\n]/)
  const text = Array.isArray(raw) ? JSON.stringify(raw) : cellText(raw)
  const items: string[] = []
  const seen = new Set<string>()
  let duplicates = 0
  for (const part of parts) {
    const item = options.lowercase ? part.trim().toLowerCase() : part.trim()
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    items.push(item)
  }
  if (!items.length) return blankValue()
  const derivations: Derivation[] = []
  if (!Array.isArray(raw) && items.length + duplicates > 1) {
    derivations.push(derivation('listSplit', text, items, `Split into ${items.length} items`))
  }
  if (duplicates) derivations.push(derivation('listDeduplicated', text, items, `Dropped ${duplicates} repeated item(s)`))
  const max = options.max
  if (max !== undefined && items.length > max) {
    const kept = items.slice(0, max)
    derivations.push(derivation('truncated', text, kept, `Kept the first ${max} items`, true))
    return readValue(kept, derivations)
  }
  return readValue(items, derivations)
}

/*------------------------------------------
 * One cell, one row
 *-----------------------------------------*/

/** Options for every parser, by kind. */
export interface DeriveOptions {
  date?: DateOptions
  dateTime?: DateTimeOptions
  number?: NumberOptions
  currency?: CurrencyOptions
  percent?: PercentOptions
  phone?: { defaultCountry?: string }
  list?: Omit<ListOptions, 'lowercase'>
}

/** A JSON cell parsed; an object or array from a JSON file passes through. */
export function deriveJson(raw: unknown): DerivedValue<unknown> {
  if (raw !== null && typeof raw === 'object') return readValue(raw)
  const text = cellText(raw)
  if (!text) return blankValue()
  try {
    return readValue(JSON.parse(text) as unknown)
  } catch {
    return unreadable('invalidJson', 'Not valid JSON.')
  }
}

/** A cell read as the field it was mapped to. */
export function deriveTransferCell(field: TransferField, raw: unknown, options: DeriveOptions = {}): DerivedValue<unknown> {
  switch (field.type) {
    case 'email':
      return deriveEmail(raw)
    case 'phone':
      return derivePhone(raw, options.phone)
    case 'url':
      return deriveUrl(raw)
    case 'number':
      return deriveNumber(raw, options.number)
    case 'integer':
      return deriveInteger(raw, options.number)
    case 'currency':
      return deriveCurrency(raw, options.currency)
    case 'percent':
      return derivePercent(raw, options.percent)
    case 'boolean':
      return deriveBoolean(raw)
    case 'date':
      return deriveDate(raw, options.date)
    case 'datetime':
      return deriveDateTime(raw, options.dateTime ?? options.date)
    case 'multiPicklist':
      return splitTransferList(raw, options.list)
    case 'tags':
      return splitTransferList(raw, { ...options.list, lowercase: true })
    case 'address':
      return parseAddressLine(raw)
    case 'json':
      return deriveJson(raw)
    case 'longText':
      return deriveText(raw, { maxLength: field.maxLength, multiline: true })
    case 'picklist':
    case 'lookup':
    case 'text':
    default:
      return deriveText(raw, { maxLength: field.maxLength })
  }
}

/** A derivation, located. */
export interface FieldDerivation extends Derivation {
  fieldId: string
}

/** A cell that could not be read, located. */
export interface FieldProblem extends DeriveProblem {
  fieldId: string
  /** The cell as the file had it. */
  raw: string
}

/** A row read field by field. */
export interface DerivedRow {
  /** Field id → value; `null` for a mapped blank cell; absent for an unmapped or dropped one. */
  values: Record<string, unknown>
  derivations: FieldDerivation[]
  problems: FieldProblem[]
}

/**
 * A mapped row read as its fields. `cells` is field id → raw cell (from
 * {@link mapTransferRow} or a JSON object); a field the catalog does not
 * know is ignored.
 */
export function deriveTransferRow(
  fields: ReadonlyMap<string, TransferField>,
  cells: Readonly<Record<string, unknown>>,
  options: DeriveOptions = {},
): DerivedRow {
  const row: DerivedRow = { values: {}, derivations: [], problems: [] }
  for (const [fieldId, raw] of Object.entries(cells)) {
    const field = fields.get(fieldId)
    if (!field) continue
    const result = deriveTransferCell(field, raw, options)
    if (!result.ok) {
      row.problems.push({ fieldId, raw: cellText(raw), ...(result.problem as DeriveProblem) })
      continue
    }
    row.values[fieldId] = result.value
    for (const entry of result.derivations) row.derivations.push({ fieldId, ...entry })
  }
  return row
}

/**
 * One line's cells under a column → field mapping, as field id → raw cell.
 * Every mapped column is present, blank or not, so a blank cell can mean
 * "clear" when the person chose that.
 */
export function mapTransferRow(
  cells: readonly unknown[],
  mapping: Readonly<Record<number, string | null | undefined>>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const [indexText, fieldId] of Object.entries(mapping)) {
    if (!fieldId) continue
    mapped[fieldId] = cells[Number(indexText)] ?? ''
  }
  return mapped
}
