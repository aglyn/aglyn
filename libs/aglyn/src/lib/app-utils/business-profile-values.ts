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
 * The pure part of the business profile: its fields, limits, sources and the
 * write rules (what the owner typed is theirs; a changed field becomes the
 * owner's). It imports nothing, so the native apps replay it from
 * `function-cases.generated.json` (AGL-3671); `business-profile.ts` re-exports
 * all of it, so every existing import is unchanged.
 */

/** The collection a profile document lives in, under a host or an org. */
export const BUSINESS_PROFILE_SUBCOLLECTION = 'businessProfile'
/** The site's profile document id. */
export const BUSINESS_PROFILE_SITE_DOC = 'profile'
/** The workspace defaults document id. */
export const BUSINESS_PROFILE_WORKSPACE_DOC = 'defaults'

/** Who wrote a stored value: the owner, the guided start's answers, or a generator. */
export type BusinessProfileSource = 'owner' | 'start' | 'ai'

/**
 * Where a RESOLVED value came from: a stored source, the site's own settings
 * (`seo.entity`, `business`, the display name), or the workspace defaults.
 */
export type BusinessProfileOrigin = BusinessProfileSource | 'site' | 'workspace'

/** How much a source's words weigh: a higher rank is never replaced by a lower one. */
const SOURCE_RANK: Readonly<Record<BusinessProfileSource, number>> = {
  ai: 1,
  start: 2,
  owner: 3,
}

export const BUSINESS_TONES = ['friendly', 'professional', 'playful', 'premium', 'plain'] as const
export type BusinessTone = (typeof BUSINESS_TONES)[number]

/** Each tone as the owner picks it and as a writer is told it. */
export const BUSINESS_TONE_LABELS: Readonly<Record<BusinessTone, string>> = {
  friendly: 'Friendly and warm',
  professional: 'Professional and clear',
  playful: 'Playful and upbeat',
  premium: 'Premium and refined',
  plain: 'Plain and direct',
}

/**
 * The fields the profile document stores itself. `founded` is the year the
 * business started (AGL-4092): the guided start asks it, and every job that
 * writes about the business reads it here rather than marking a gap for it.
 */
export const BUSINESS_PROFILE_FIELDS = [
  'whatYouDo',
  'services',
  'serviceArea',
  'audience',
  'tone',
  'toneNotes',
  'founded',
] as const
export type BusinessProfileField = (typeof BUSINESS_PROFILE_FIELDS)[number]

/** Each field's ceiling, in characters; `services` is per item. */
export const BUSINESS_PROFILE_MAX_CHARS: Readonly<Record<Exclude<BusinessProfileField, 'tone'>, number>> = {
  whatYouDo: 200,
  services: 60,
  serviceArea: 120,
  audience: 160,
  toneNotes: 200,
  /** A year, four digits, as the guided start asks it. */
  founded: 4,
}

/** At most this many services are kept. */
export const BUSINESS_PROFILE_MAX_SERVICES = 12

/** The stored document, at either level. */
export interface BusinessProfileDoc {
  whatYouDo?: string
  services?: string[]
  serviceArea?: string
  audience?: string
  tone?: BusinessTone | null
  toneNotes?: string
  /** The year the business started, four digits: `2019`. */
  founded?: string
  /** Who wrote each stored value; a value without one is the owner's. */
  sources?: Partial<Record<BusinessProfileField, BusinessProfileSource>>
  updatedAt?: unknown
  updatedBy?: string | null
}

/** The values a write carries, before they are sanitized. */
export type BusinessProfileValues = Partial<
  Pick<BusinessProfileDoc, 'whatYouDo' | 'services' | 'serviceArea' | 'audience' | 'tone' | 'toneNotes' | 'founded'>
>

export const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const tone = (value: unknown): BusinessTone | null =>
  (BUSINESS_TONES as readonly unknown[]).includes(value) ? (value as BusinessTone) : null

const services = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : []
  const seen = new Set<string>()
  const kept: string[] = []
  for (const item of items) {
    const name = text(item, BUSINESS_PROFILE_MAX_CHARS.services)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    kept.push(name)
    if (kept.length >= BUSINESS_PROFILE_MAX_SERVICES) break
  }
  return kept
}

/** One field's stored value, sanitized; empty is `''`, `[]` or `null`. */
export function fieldValue(doc: BusinessProfileValues | null | undefined, field: BusinessProfileField): unknown {
  switch (field) {
    case 'services':
      return services(doc?.services)
    case 'tone':
      return tone(doc?.tone)
    default:
      return text(doc?.[field], BUSINESS_PROFILE_MAX_CHARS[field])
  }
}

/**
 * What is wrong with a year founded as the owner typed it (AGL-4092), or
 * `null` when nothing is: empty, or four digits no later than this year —
 * the guided start's own rule.
 */
export function businessProfileFoundedProblem(value: unknown, now: Date = new Date()): string | null {
  const year = typeof value === 'string' ? value.trim() : ''
  if (!year) return null
  const latest = now.getFullYear()
  return /^\d{4}$/.test(year) && Number(year) >= 1000 && Number(year) <= latest
    ? null
    : `Enter the year as four digits, like ${latest - 10}.`
}

export const isEmpty = (value: unknown): boolean =>
  value === null || value === '' || (Array.isArray(value) && value.length === 0)

/** The source a stored, non-empty value carries; the owner's when none is recorded. */
export function businessProfileSourceOf(
  doc: BusinessProfileDoc | null | undefined,
  field: BusinessProfileField,
): BusinessProfileSource | null {
  if (isEmpty(fieldValue(doc, field))) return null
  const source = doc?.sources?.[field]
  return source && source in SOURCE_RANK ? source : 'owner'
}

/** Every value a write may carry, sanitized; an absent field stays absent. */
export function sanitizeBusinessProfileValues(values: BusinessProfileValues): BusinessProfileValues {
  const clean: BusinessProfileValues = {}
  for (const field of BUSINESS_PROFILE_FIELDS) {
    if (!(field in values)) continue
    ;(clean as Record<string, unknown>)[field] = fieldValue(values, field)
  }
  return clean
}

/**
 * The document a generator's or the guided start's values make of the stored
 * one: each value fills a field that is empty or was written by a source that
 * weighs less, and nothing else. `null` when nothing would change, so a caller
 * writes only when there is something to write.
 */
export function mergeBusinessProfilePrefill(
  current: BusinessProfileDoc | null | undefined,
  values: BusinessProfileValues,
  source: Exclude<BusinessProfileSource, 'owner'>,
): BusinessProfileDoc | null {
  const clean = sanitizeBusinessProfileValues(values)
  const next: BusinessProfileDoc = { ...(current ?? {}), sources: { ...(current?.sources ?? {}) } }
  let changed = false
  for (const field of BUSINESS_PROFILE_FIELDS) {
    if (!(field in clean)) continue
    const value = (clean as Record<string, unknown>)[field]
    if (isEmpty(value)) continue
    // An explicit source counts even on an empty value: a field the owner
    // cleared stays cleared rather than being refilled behind them.
    const recorded = current?.sources?.[field]
    const held = recorded && recorded in SOURCE_RANK ? recorded : businessProfileSourceOf(current, field)
    if (held && SOURCE_RANK[held] >= SOURCE_RANK[source]) continue
    if (JSON.stringify(fieldValue(current, field)) === JSON.stringify(value)) continue
    ;(next as Record<string, unknown>)[field] = value
    next.sources![field] = source
    changed = true
  }
  return changed ? next : null
}

/**
 * The document the owner's save makes: every field they changed becomes
 * theirs, and a field they left as it was keeps the source it had — so saving
 * the form after correcting one line does not claim every suggestion on it.
 */
export function businessProfileOwnerWrite(
  current: BusinessProfileDoc | null | undefined,
  edited: BusinessProfileValues,
): Pick<BusinessProfileDoc, BusinessProfileField | 'sources'> {
  const clean = sanitizeBusinessProfileValues(edited)
  const next: Record<string, unknown> = {}
  const sources: Partial<Record<BusinessProfileField, BusinessProfileSource>> = {}
  for (const field of BUSINESS_PROFILE_FIELDS) {
    const before = fieldValue(current, field)
    const after = field in clean ? (clean as Record<string, unknown>)[field] : before
    next[field] = after
    const same = JSON.stringify(before) === JSON.stringify(after)
    if (isEmpty(after)) {
      // A suggestion the owner deleted is their decision, and recorded as
      // one, so the next prefill does not put it back.
      if (!same) sources[field] = 'owner'
      else if (current?.sources?.[field] === 'owner') sources[field] = 'owner'
      continue
    }
    sources[field] = same ? (businessProfileSourceOf(current, field) ?? 'owner') : 'owner'
  }
  return { ...(next as Pick<BusinessProfileDoc, BusinessProfileField>), sources }
}
