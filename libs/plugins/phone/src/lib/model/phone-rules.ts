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

import { normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import type {
  PhoneComplianceForm,
  PhoneOpenSpan,
  PhoneSettings,
  PhoneTemplate,
} from './phone.types'

/**
 * Phone's pure rules (AGL-4251): what both halves and the specs agree on
 * without a store, a clock or Twilio.
 */

/** A number as E.164, or null. North American numbers may be typed without +1. */
export function phoneE164(input: unknown): string | null {
  return normalizePhone(typeof input === 'string' ? input : String(input ?? ''))
}

/**
 * North American area codes that are NOT the US or Canada: the Caribbean
 * nations and Bermuda. Phone's calls are unlimited within the US and Canada
 * only, and these are where international toll fraud dials.
 */
const NANP_OUTSIDE_US_CA = new Set([
  '242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721',
  '758', '767', '784', '809', '829', '849', '868', '869', '876',
])

/** Whether an E.164 number is in the US (territories included) or Canada. */
export function isUsOrCanadaNumber(e164: string | null | undefined): boolean {
  const match = /^\+1(\d{3})\d{7}$/.exec(String(e164 ?? ''))
  return Boolean(match && !NANP_OUTSIDE_US_CA.has(match[1]))
}

/** "(830) 555-0142" for a North American number, else the E.164 as is. */
export function formatPhoneForDisplay(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164
}

/**
 * A thread's id: one per pair of numbers, so a reply, a second text and a
 * call all land in one conversation. Digits only, so it is a plain path segment.
 */
export function phoneThreadId(ours: string, theirs: string): string {
  return `${ours.replace(/\D/g, '')}_${theirs.replace(/\D/g, '')}`
}

/** Minutes after local midnight and the weekday, in `timeZone`, at `atMs`. */
export function localClock(atMs: number, timeZone: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(atMs))
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(atMs))
  }
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(read('weekday'))
  const minute = Number(read('hour')) * 60 + Number(read('minute'))
  return { day: day < 0 ? 0 : day, minute }
}

/**
 * Whether the business is open at `atMs`. No hours set means always open: a
 * number that was never given hours rings, rather than sending every caller
 * to voicemail.
 */
export function isOpenAt(
  settings: Pick<PhoneSettings, 'hours' | 'timeZone'>,
  atMs: number,
): boolean {
  const hours = settings.hours ?? []
  if (!hours.length) return true
  const { day, minute } = localClock(atMs, settings.timeZone || 'America/Chicago')
  return hours.some((span) => spanCovers(span, day, minute))
}

function spanCovers(span: PhoneOpenSpan, day: number, minute: number): boolean {
  if (span.closeMinute > span.openMinute) {
    return span.day === day && minute >= span.openMinute && minute < span.closeMinute
  }
  // Past midnight: open late on `span.day`, or early on the next day.
  if (span.day === day && minute >= span.openMinute) return true
  return (span.day + 1) % 7 === day && minute < span.closeMinute
}

/**
 * What a template's placeholders fill in from: the number's site. A booking
 * or waiver page is a link the owner pastes into the template itself.
 */
export interface PhoneTemplateLinks {
  siteLink?: string | null
  businessName?: string | null
}

const PLACEHOLDERS = ['siteLink', 'businessName'] as const

/**
 * A template's text with `{siteLink}` and `{businessName}` filled in. A
 * placeholder with nothing to fill is left out, never sent as a literal brace.
 */
export function fillPhoneTemplate(body: string, links: PhoneTemplateLinks): string {
  let text = String(body ?? '')
  for (const key of PLACEHOLDERS) {
    text = text.split(`{${key}}`).join(String(links[key] ?? '').trim())
  }
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

/** The templates a workspace starts with. Plain words; the owner edits them. */
export const DEFAULT_PHONE_TEMPLATES: readonly PhoneTemplate[] = [
  { id: 'website', label: 'Website', body: 'Everything is on our website: {siteLink}' },
  { id: 'thanks', label: 'Thank you', body: 'Thanks for reaching out to {businessName}! We will get back to you shortly.' },
]

/** The settings a workspace starts with. */
export function defaultPhoneSettings(nowMs: number, timeZone = 'America/Chicago'): PhoneSettings {
  return {
    timeZone,
    hours: [],
    ringDuringHours: 'cells',
    forwardTo: [],
    ringSeconds: 25,
    voicemailGreeting: 'Sorry we missed you. Please leave a message after the tone.',
    closedGreeting: 'We are closed right now. Please leave a message after the tone and we will call you back.',
    voicemailTranscription: true,
    missedCallText: '',
    templates: [...DEFAULT_PHONE_TEMPLATES],
    updatedAtMs: nowMs,
  }
}

/** Reads settings a request sent, clamped to what the routes accept. Null fields keep `current`. */
export function sanitizePhoneSettings(input: unknown, current: PhoneSettings, nowMs: number): PhoneSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const text = (value: unknown, fallback: string, max: number) =>
    typeof value === 'string' ? value.trim().slice(0, max) : fallback
  const hours = Array.isArray(raw['hours'])
    ? (raw['hours'] as unknown[])
        .map((span) => span as Record<string, unknown>)
        .filter(
          (span) =>
            Number.isInteger(span['day']) &&
            Number(span['day']) >= 0 &&
            Number(span['day']) <= 6 &&
            Number.isInteger(span['openMinute']) &&
            Number.isInteger(span['closeMinute']) &&
            Number(span['openMinute']) >= 0 &&
            Number(span['openMinute']) < 1440 &&
            Number(span['closeMinute']) >= 0 &&
            Number(span['closeMinute']) <= 1440 &&
            span['openMinute'] !== span['closeMinute'],
        )
        .slice(0, 28)
        .map((span) => ({
          day: Number(span['day']),
          openMinute: Number(span['openMinute']),
          closeMinute: Number(span['closeMinute']),
        }))
    : current.hours
  const forwardTo = Array.isArray(raw['forwardTo'])
    ? [...new Set((raw['forwardTo'] as unknown[]).map(phoneE164).filter((n): n is string => isUsOrCanadaNumber(n)))].slice(0, 5)
    : current.forwardTo
  const ring = raw['ringDuringHours']
  const templates = Array.isArray(raw['templates'])
    ? (raw['templates'] as unknown[])
        .map((one) => one as Record<string, unknown>)
        .filter((one) => typeof one['label'] === 'string' && typeof one['body'] === 'string')
        .slice(0, 30)
        .map((one, index) => ({
          id: typeof one['id'] === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(one['id']) ? one['id'] : `t${index + 1}`,
          label: String(one['label']).trim().slice(0, 60),
          body: String(one['body']).trim().slice(0, 640),
        }))
        .filter((one) => one.label && one.body)
    : current.templates
  const ringSeconds = Number(raw['ringSeconds'])
  return {
    timeZone: isTimeZone(raw['timeZone']) ? String(raw['timeZone']) : current.timeZone,
    hours,
    ringDuringHours: ring === 'apps' || ring === 'cells' || ring === 'both' ? ring : current.ringDuringHours,
    forwardTo,
    ringSeconds: Number.isFinite(ringSeconds) ? Math.min(60, Math.max(10, Math.round(ringSeconds))) : current.ringSeconds,
    voicemailGreeting: text(raw['voicemailGreeting'], current.voicemailGreeting, 400),
    closedGreeting: text(raw['closedGreeting'], current.closedGreeting, 400),
    voicemailTranscription:
      typeof raw['voicemailTranscription'] === 'boolean' ? raw['voicemailTranscription'] : current.voicemailTranscription,
    missedCallText: text(raw['missedCallText'], current.missedCallText, 320),
    templates,
    updatedAtMs: nowMs,
  }
}

function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** The fields a texting registration cannot be submitted without, by the name the form shows. */
export function missingComplianceFields(form: Partial<PhoneComplianceForm>): string[] {
  const missing: string[] = []
  const need = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !value.trim()) missing.push(label)
  }
  need(form.legalBusinessName, 'Legal business name')
  if (form.businessType !== 'sole-proprietor') need(form.ein, 'EIN')
  need(form.website, 'Website')
  need(form.street, 'Street address')
  need(form.city, 'City')
  need(form.region, 'State')
  need(form.postalCode, 'ZIP code')
  need(form.contactFirstName, 'Contact first name')
  need(form.contactLastName, 'Contact last name')
  need(form.contactEmail, 'Contact email')
  need(form.contactPhone, 'Contact phone')
  need(form.useCaseDescription, 'What your texts are for')
  need(form.optInDescription, 'How customers agree to texts')
  const samples = (form.sampleMessages ?? []).filter((one) => typeof one === 'string' && one.trim())
  if (samples.length < 2) missing.push('Two example texts')
  return missing
}

/** The inbound words that opt a number out of, and back into, texts. */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout'])
const START_WORDS = new Set(['start', 'unstop', 'yes'])

export function inboundKeyword(body: string): 'stop' | 'start' | null {
  const word = String(body ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (STOP_WORDS.has(word)) return 'stop'
  if (START_WORDS.has(word)) return 'start'
  return null
}
