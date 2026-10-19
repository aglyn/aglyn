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
  AREA_SERVED_MAX,
  PRICE_RANGE_MAX_LENGTH,
  normalizeAreaServed,
  parseOpeningHours,
  type OpeningHoursRow,
} from '@aglyn/aglyn/app-utils/local-business'

/**
 * The business details a guided start may be given beyond what the site is
 * for (AGL-3979): how to reach it, where it is, when it is open, where it
 * works and the profiles that are its own. Every one is optional. Given,
 * they are what makes a new site read as this business the first time its
 * owner opens it — the phone number in the footer, the email on the contact
 * page — and what its structured data and its `/llms.txt` say about it.
 *
 * They travel as flat strings among the `site` job's scalar inputs, like the
 * answers before them, so a failed start's summary carries them back and Try
 * again reopens the questions filled in. Each one has its own rule here,
 * shared by the questions (which say what is wrong beside the field) and the
 * create door (`parseAiSiteJobInputs`, which refuses what the questions would
 * not have sent).
 *
 * Pure: strings in, strings out.
 */

/** Every detail, by its input key. */
export const AI_SITE_DETAIL_KEYS = [
  'phone',
  'email',
  'tagline',
  'founded',
  'serviceArea',
  'priceRange',
  'languages',
  'street',
  'region',
  'postalCode',
  'country',
  'hours',
  'social',
] as const

export type AiSiteDetailKey = (typeof AI_SITE_DETAIL_KEYS)[number]

/** The details as a job's inputs carry them, each `''` where nobody said. */
export type AiSiteDetails = Record<AiSiteDetailKey, string>

/** The longest each detail may be, in characters. Together far under the door's 8,000. */
export const AI_SITE_DETAIL_MAX_CHARS: Readonly<Record<AiSiteDetailKey, number>> = {
  phone: 32,
  email: 254,
  tagline: 120,
  founded: 4,
  serviceArea: 400,
  priceRange: PRICE_RANGE_MAX_LENGTH,
  languages: 120,
  street: 120,
  region: 80,
  postalCode: 20,
  country: 80,
  hours: 600,
  social: 1_200,
}

/** The most profile links a start takes. */
export const AI_SITE_SOCIAL_MAX = 6

/** No details at all. */
export const AI_SITE_NO_DETAILS: Readonly<AiSiteDetails> = Object.fromEntries(
  AI_SITE_DETAIL_KEYS.map((key) => [key, '']),
) as unknown as AiSiteDetails

/** Why a detail cannot be used, as a closed code the funnel counts and a sentence beside the field. */
export interface AiSiteDetailProblem {
  code: 'too_long' | 'invalid'
  message: string
}

const PHONE_CHARS = /^\+?[\d\s().-]+$/

/** Whether a phone number reads as one: digits with the usual separators, a `+` only first, 7 to 15 digits. */
export function aiSitePhoneValid(value: string): boolean {
  const text = value.trim()
  if (!PHONE_CHARS.test(text)) return false
  const digits = text.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

/**
 * The `tel:` address of a phone number, or `''` for one that does not read.
 *
 * Its digits are the number's own, with a `+` only where the person typed one:
 * no country is inferred, so the link dials the number exactly as given, and
 * the layout's own check, which reads a number by its digits, finds the same
 * digits in the brief as in the link.
 */
export function aiSitePhoneHref(value: string): string {
  if (!aiSitePhoneValid(value)) return ''
  const text = value.trim()
  return `tel:${text.startsWith('+') ? '+' : ''}${text.replace(/\D/g, '')}`
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/

/** Whether an email address reads as one. */
export function aiSiteEmailValid(value: string): boolean {
  const text = value.trim()
  return text.length <= AI_SITE_DETAIL_MAX_CHARS.email && EMAIL.test(text)
}

/** The `mailto:` address of an email, or `''` for one that does not read. */
export function aiSiteEmailHref(value: string): string {
  return aiSiteEmailValid(value) ? `mailto:${value.trim()}` : ''
}

/** A link typed without its scheme is the https page it names; a plain `http:` one is read as https. */
function asHttps(value: string): string {
  const text = value.trim()
  if (/^https:\/\//i.test(text)) return text
  if (/^http:\/\//i.test(text)) return `https://${text.slice(7)}`
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]\S*)?$/i.test(text)) return `https://${text}`
  return text
}

function isHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.includes('.')
  } catch {
    return false
  }
}

/**
 * The profile links a detail names, one a line (commas and spaces separate
 * them too), each an https page, at most {@link AI_SITE_SOCIAL_MAX}, each
 * once; `null` when one of them is not a link at all.
 */
export function aiSiteSocialLinks(value: string): string[] | null {
  const links: string[] = []
  for (const part of value.split(/[\s,]+/)) {
    if (!part.trim()) continue
    const link = asHttps(part)
    if (!isHttps(link)) return null
    if (!links.some((seen) => seen.toLowerCase() === link.toLowerCase())) links.push(link)
  }
  return links.slice(0, AI_SITE_SOCIAL_MAX)
}

/** The areas a detail names, one a line or separated by commas, each once, at most twenty. */
export function aiSiteServiceAreas(value: string): string[] {
  return normalizeAreaServed(value.split(/\r?\n|,|;/)).slice(0, AREA_SERVED_MAX)
}

/** The opening hours a detail holds, as the lines that read (`Mo-Fr 09:00-17:00`), one a line. */
export function aiSiteHoursText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && parseOpeningHours(line).length)
    .join('\n')
}

const DAY_SHORT: Readonly<Record<string, string>> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
}
const WEEK = Object.keys(DAY_SHORT)

/** "09:00" as "9am", "17:30" as "5:30pm", "00:00" as "12am". */
function clock(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`
}

/** A row's days as a reader says them: "Mon–Fri" for a run, "Mon, Wed" otherwise. */
function daysOf(row: OpeningHoursRow): string {
  const at = row.days.map((day) => WEEK.indexOf(day)).sort((a, b) => a - b)
  const run = at.every((index, position) => position === 0 || index === at[position - 1] + 1)
  if (run && at.length > 2) return `${DAY_SHORT[WEEK[at[0]]]}–${DAY_SHORT[WEEK[at[at.length - 1]]]}`
  return at.map((index) => DAY_SHORT[WEEK[index]]).join(', ')
}

/**
 * The opening hours as a person reads them — "Mon–Fri 9am–5pm; Sat 10am–2pm"
 * — which is how the brief states them: the layout's own check admits a
 * footer's hours only where the brief gives hours it can read as hours, and
 * `Mo-Fr 09:00-17:00` is written for a machine.
 */
export function aiSiteHoursSentence(value: string): string {
  return parseOpeningHours(value)
    .map((row) => `${daysOf(row)} ${clock(row.opens)}–${clock(row.closes)}`)
    .join('; ')
}

/**
 * What is wrong with one detail, worded for the person beside its field; `null`
 * when it may be used. An empty detail is always fine: every one is optional.
 */
export function aiSiteDetailProblem(
  key: AiSiteDetailKey,
  raw: unknown,
  options: { now?: Date } = {},
): AiSiteDetailProblem | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return { code: 'invalid', message: 'Use plain text here.' }
  const value = raw.trim()
  if (!value) return null
  const max = AI_SITE_DETAIL_MAX_CHARS[key]
  if (value.length > max) return { code: 'too_long', message: `Keep this under ${max} characters.` }
  switch (key) {
    case 'phone':
      return aiSitePhoneValid(value)
        ? null
        : { code: 'invalid', message: 'Enter the phone number with its area code, like (512) 555-0142 or +44 20 7946 0958.' }
    case 'email':
      return aiSiteEmailValid(value) ? null : { code: 'invalid', message: 'Enter an email address, like hello@yourbusiness.com.' }
    case 'founded': {
      const year = Number(value)
      const latest = (options.now ?? new Date()).getFullYear()
      return /^\d{4}$/.test(value) && year >= 1000 && year <= latest
        ? null
        : { code: 'invalid', message: `Enter the year as four digits, like ${latest - 10}.` }
    }
    case 'social':
      return aiSiteSocialLinks(value)
        ? null
        : { code: 'invalid', message: 'Paste each profile’s address, one a line, like instagram.com/yourbusiness.' }
    default:
      return null
  }
}

/**
 * The details a job's inputs carry, each held to its rule and tidied — the
 * profile links as https pages one a line, the areas one a line, only the
 * opening hours that read — or the sentence the create door refuses them
 * with. A key the inputs leave out is `''`.
 */
export function parseAiSiteDetails(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
  options: { now?: Date } = {},
): AiSiteDetails | string {
  const details = { ...AI_SITE_NO_DETAILS }
  for (const key of AI_SITE_DETAIL_KEYS) {
    const raw = inputs?.[key]
    const problem = aiSiteDetailProblem(key, raw, options)
    if (problem) return `${key}: ${problem.message}`
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) continue
    details[key] =
      key === 'social'
        ? (aiSiteSocialLinks(value) ?? []).join('\n')
        : key === 'serviceArea'
          ? aiSiteServiceAreas(value).join('\n')
          : key === 'hours'
            ? aiSiteHoursText(value)
            : value.replace(/[ \t]+/g, ' ')
  }
  return details
}

/** A job's details, read leniently: anything that breaks its rule reads as not given. */
export function aiSiteDetailsOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteDetails {
  const details = { ...AI_SITE_NO_DETAILS }
  for (const key of AI_SITE_DETAIL_KEYS) {
    const one = parseAiSiteDetails({ [key]: inputs?.[key] })
    if (typeof one !== 'string') details[key] = one[key]
  }
  return details
}

/** How a visitor reaches the business, as the pages link it; `null` when neither was given. */
export interface AiSiteContact {
  /** The number as the person wrote it, which is how the pages show it. */
  phone: string
  phoneHref: string
  email: string
  emailHref: string
}

/** The phone and email a job's inputs give, with the links they make; `null` for neither. */
export function aiSiteContactOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteContact | null {
  const details = aiSiteDetailsOf(inputs)
  const phoneHref = aiSitePhoneHref(details.phone)
  const emailHref = aiSiteEmailHref(details.email)
  if (!phoneHref && !emailHref) return null
  return {
    phone: phoneHref ? details.phone : '',
    phoneHref,
    email: emailHref ? details.email : '',
    emailHref,
  }
}

/** The street address the details and the city make, as one line: "214 Main Street, Austin, TX 78701, US". */
export function aiSiteAddressLine(details: Pick<AiSiteDetails, 'street' | 'region' | 'postalCode' | 'country'>, city = ''): string {
  const regional = [details.region, details.postalCode].map((part) => part.trim()).filter(Boolean).join(' ')
  return [details.street, city, regional, details.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * What every unit of a site job is told about the business beyond what it is
 * (AGL-3979), on the job's own turn: its contact details, place and hours,
 * then everything else the person gave, then — where there is a phone or an
 * email — that the pages show them as written and how a link calls or writes.
 * Empty when the person gave no details, so a start without them is told
 * exactly what it was told before.
 */
export function aiSiteDetailsBriefLines(details: AiSiteDetails, options: { city?: string } = {}): string[] {
  const lines: string[] = []
  const address = details.street ? aiSiteAddressLine(details, options.city ?? '') : ''
  const hours = aiSiteHoursSentence(details.hours)
  const contact = [
    details.phone ? `phone: ${details.phone}` : '',
    details.email ? `email: ${details.email}` : '',
    address ? `address: ${address}` : '',
    hours ? `hours: ${hours}` : '',
  ].filter(Boolean)
  if (contact.length) lines.push(`Contact — ${contact.join('; ')}.`)
  const areas = aiSiteServiceAreas(details.serviceArea)
  const social = details.social ? details.social.split('\n').filter(Boolean) : []
  const more = [
    details.tagline ? `tagline: ${details.tagline}` : '',
    details.founded ? `founded: ${details.founded}` : '',
    areas.length ? `serves: ${areas.join(', ')}` : '',
    details.priceRange ? `price range: ${details.priceRange}` : '',
    details.languages ? `languages: ${details.languages}` : '',
    social.length ? `profiles: ${social.join(', ')}` : '',
  ].filter(Boolean)
  if (more.length) lines.push(`About the business — ${more.join('; ')}.`)
  if (details.phone || details.email) {
    const what = details.phone && details.email ? 'phone number and email' : details.phone ? 'phone number' : 'email'
    const links = [details.phone ? 'a link that calls goes to "phone"' : '', details.email ? 'a link that writes goes to "email"' : '']
      .filter(Boolean)
      .join(' and ')
    lines.push(
      `Show the ${what} exactly as written wherever a visitor looks for a way to get in touch: the contact page, the footer, and the buttons that ask a visitor to call or write; ${links}.`,
    )
  }
  return lines
}
