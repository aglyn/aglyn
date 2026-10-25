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

import { parseMarkdownLite, type MarkdownInline } from '@aglyn/aglyn/app-utils/markdown-lite'

/*==========================================
 * A WAIVER (AGL-4042): the merchant's own words, in the console's rich text
 * editor, with the checkboxes a signer must tick, whether a parent may sign
 * for minors, and how long one signature lasts. Pure: the console, the
 * signing page and the server all read these rules from here.
 *=========================================*/

export type WaiverStatus = 'draft' | 'published' | 'retired'

/**
 * How long one signature covers its signer:
 * - `visit` (the default): the day they signed, in the site's time zone;
 * - `season`: through the last day of a season the merchant names;
 * - `days`: N days, the signing day included (365 for a year).
 */
export type WaiverValidity =
  | { kind: 'visit' }
  | { kind: 'season'; endDayKey: string }
  | { kind: 'days'; days: number }

export interface WaiverCheckbox {
  /** Stable within the waiver, so a signature names what was ticked. */
  id: string
  label: string
}

/** What the merchant writes and the editor saves. */
export interface WaiverDraft {
  title: string
  /** Markdown-lite from the rich text editor; never shown as syntax. */
  body: string
  checkboxes: WaiverCheckbox[]
  allowMinors: boolean
  validity: WaiverValidity
}

/** A waiver as stored, under `orgs/{orgId}/waivers/{waiverId}`. */
export interface WaiverTemplate extends WaiverDraft {
  id: string
  orgId: string
  /** The site it is signed for. */
  hostId: string
  status: WaiverStatus
  /** Bumped on every saved change; a signature keeps the one it agreed to. */
  version: number
  createdAtMs: number
  updatedAtMs: number
  publishedAtMs?: number | null
  updatedBy?: string | null
}

export const WAIVER_LIMITS = {
  title: 120,
  body: 30000,
  checkboxes: 12,
  checkboxLabel: 300,
  days: 400,
  minors: 10,
  name: 120,
  email: 254,
  phone: 40,
  relationship: 60,
} as const

export const WAIVER_STATUS_LABELS: Record<WaiverStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  retired: 'Retired',
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whether a string is a real calendar day, `YYYY-MM-DD`. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DAY_KEY.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

/** The calendar day an instant falls on in a time zone, `YYYY-MM-DD`. */
export function dayKeyIn(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms))
    const part = (type: string) => parts.find((one) => one.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}`
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/** A day key moved by whole days. */
export function addDays(dayKey: string, days: number): string {
  const match = DAY_KEY.exec(dayKey)
  if (!match) return dayKey
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

/** The last day one signature made on `signedDayKey` covers. */
export function validThroughDayKey(validity: WaiverValidity, signedDayKey: string): string {
  if (validity.kind === 'days') return addDays(signedDayKey, Math.max(1, validity.days) - 1)
  if (validity.kind === 'season') {
    // A season that already ended covers the signing day only.
    return validity.endDayKey >= signedDayKey ? validity.endDayKey : signedDayKey
  }
  return signedDayKey
}

/** How the console and the signing page say what one signature covers. */
export function validityLabel(validity: WaiverValidity): string {
  if (validity.kind === 'days') {
    if (validity.days === 1) return 'Good for the day it is signed'
    if (validity.days === 365) return 'Good for a year'
    return `Good for ${validity.days} days`
  }
  if (validity.kind === 'season') return `Good through ${formatDayKey(validity.endDayKey)}`
  return 'Good for one visit (the day it is signed)'
}

/** `2026-10-24` as `Oct 24, 2026`. */
export function formatDayKey(dayKey: string): string {
  const match = DAY_KEY.exec(String(dayKey ?? ''))
  if (!match) return String(dayKey ?? '')
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const cleanLine = (value: unknown, max: number): string =>
  String(value ?? '')
    // Control characters out of a single line of what somebody typed.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

function normalizeValidity(raw: unknown): WaiverValidity | string {
  const value = (raw && typeof raw === 'object' ? raw : { kind: 'visit' }) as Record<string, unknown>
  if (value['kind'] === 'season') {
    const end = String(value['endDayKey'] ?? '')
    return isDayKey(end) ? { kind: 'season', endDayKey: end } : 'Choose the last day of the season.'
  }
  if (value['kind'] === 'days') {
    const days = Number(value['days'])
    if (!Number.isInteger(days) || days < 1 || days > WAIVER_LIMITS.days) {
      return `A waiver can be good for 1 to ${WAIVER_LIMITS.days} days.`
    }
    return { kind: 'days', days }
  }
  return { kind: 'visit' }
}

/** A draft from whatever a client sent, or the sentence that says what to fix. */
export function normalizeWaiverDraft(
  raw: unknown,
): { ok: true; draft: WaiverDraft } | { ok: false; error: string } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = cleanLine(input['title'], WAIVER_LIMITS.title + 1)
  if (!title) return { ok: false, error: 'Give the waiver a title.' }
  if (title.length > WAIVER_LIMITS.title) {
    return { ok: false, error: `Keep the title under ${WAIVER_LIMITS.title} characters.` }
  }
  const body = String(input['body'] ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!waiverBodyText(body)) return { ok: false, error: 'Write the waiver’s text.' }
  if (body.length > WAIVER_LIMITS.body) {
    return { ok: false, error: 'The waiver’s text is too long. Shorten it and save again.' }
  }
  const rawBoxes = Array.isArray(input['checkboxes']) ? input['checkboxes'] : []
  if (rawBoxes.length > WAIVER_LIMITS.checkboxes) {
    return { ok: false, error: `A waiver can have up to ${WAIVER_LIMITS.checkboxes} checkboxes.` }
  }
  const checkboxes: WaiverCheckbox[] = []
  const seen = new Set<string>()
  for (const [index, entry] of rawBoxes.entries()) {
    const box = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const label = cleanLine(box['label'], WAIVER_LIMITS.checkboxLabel + 1)
    if (!label) return { ok: false, error: `Checkbox ${index + 1} needs its words, or remove it.` }
    if (label.length > WAIVER_LIMITS.checkboxLabel) {
      return { ok: false, error: `Checkbox ${index + 1} is too long.` }
    }
    let id = cleanLine(box['id'], 40).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id || seen.has(id)) id = `box-${index + 1}`
    while (seen.has(id)) id = `${id}-x`
    seen.add(id)
    checkboxes.push({ id, label })
  }
  const validity = normalizeValidity(input['validity'])
  if (typeof validity === 'string') return { ok: false, error: validity }
  return {
    ok: true,
    draft: { title, body, checkboxes, allowMinors: input['allowMinors'] === true, validity },
  }
}

/** Whether a saved change alters what a signer agrees to (and so bumps the version). */
export function draftChangesText(before: WaiverDraft, after: WaiverDraft): boolean {
  return JSON.stringify(waiverSnapshot(before)) !== JSON.stringify(waiverSnapshot(after))
}

/** The parts of a waiver a version freezes. */
export function waiverSnapshot(draft: WaiverDraft): WaiverDraft {
  return {
    title: draft.title,
    body: draft.body,
    checkboxes: draft.checkboxes.map((box) => ({ id: box.id, label: box.label })),
    allowMinors: draft.allowMinors,
    validity: draft.validity,
  }
}

const inlineText = (inlines: readonly MarkdownInline[]): string =>
  inlines
    .map((inline) => inline.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The waiver's words as plain text, one paragraph per line, list items
 * bulleted and numbered: what the PDF prints and what the signed text's
 * hash is taken over. Images and code carry no agreement and are left out.
 */
export function waiverBodyText(body: string): string {
  const lines: string[] = []
  for (const block of parseMarkdownLite(String(body ?? ''))) {
    if ('inlines' in block) {
      const text = inlineText(block.inlines)
      if (text) lines.push(text)
    } else if (block.type === 'list') {
      for (const item of block.items) lines.push(`• ${inlineText(item)}`)
    } else if (block.type === 'orderedList') {
      block.items.forEach((item, index) => lines.push(`${block.start + index}. ${inlineText(item)}`))
    } else if (block.type === 'table') {
      for (const row of [block.header, ...block.rows]) lines.push(row.map(inlineText).join(' | '))
    }
  }
  return lines.join('\n\n').trim()
}
