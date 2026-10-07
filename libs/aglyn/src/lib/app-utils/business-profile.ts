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

import { siteProfileUrls, type HostSeoEntity } from './content-authors'
import { normalizeAreaServed } from './local-business'

/**
 * A site's BUSINESS PROFILE (AGL-3661): what the business is, as everything
 * that writes about it needs to know — the site's own pages, the structured
 * data, and any generator a plugin brings.
 *
 * ── Most of it is already stored, so this stores only the rest ─────────────
 *
 * The site's name, its one-line description, its contact details, its hours,
 * the areas it serves and its social profiles all have a home on the host
 * document already: `seo.entity` (the publisher entity the JSON-LD is built
 * from, edited in Setup → SEO) and `business` (the contact card the `host.*`
 * tokens and the footer read, edited in Setup → Basic details). Copying them
 * here would make two places to keep in step, and the copy would drift.
 *
 * So the profile document holds only what has no home yet — the services, the
 * audience, the tone of voice — plus a line about the business and the area it
 * serves for a site whose SEO entity does not say. {@link resolveBusinessProfile}
 * reads the two together into one picture, field by field, and says where
 * each value came from.
 *
 * ── Where it is stored ────────────────────────────────────────────────────
 *
 * `hosts/{hostId}/businessProfile/profile` for a site and
 * `orgs/{orgId}/businessProfile/defaults` for the workspace, whose values a
 * site inherits where it has none of its own. A subcollection document rather
 * than a key on the host: the host document's `business` map is replaced
 * whole by the contact card's save, and a key beside it would be one more
 * thing a partial write could blank.
 *
 * ── Whose words win ───────────────────────────────────────────────────────
 *
 * Every stored value carries its source. What the owner typed is never
 * replaced by anything else; what the guided start was told replaces only
 * what a generator guessed; and a generator's guess fills only what is empty.
 * {@link mergeBusinessProfilePrefill} is the one place that rule is applied.
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

/** The fields the profile document stores itself. */
export const BUSINESS_PROFILE_FIELDS = [
  'whatYouDo',
  'services',
  'serviceArea',
  'audience',
  'tone',
  'toneNotes',
] as const
export type BusinessProfileField = (typeof BUSINESS_PROFILE_FIELDS)[number]

/** Each field's ceiling, in characters; `services` is per item. */
export const BUSINESS_PROFILE_MAX_CHARS: Readonly<Record<Exclude<BusinessProfileField, 'tone'>, number>> = {
  whatYouDo: 200,
  services: 60,
  serviceArea: 120,
  audience: 160,
  toneNotes: 200,
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
  /** Who wrote each stored value; a value without one is the owner's. */
  sources?: Partial<Record<BusinessProfileField, BusinessProfileSource>>
  updatedAt?: unknown
  updatedBy?: string | null
}

/** The values a write carries, before they are sanitized. */
export type BusinessProfileValues = Partial<
  Pick<BusinessProfileDoc, 'whatYouDo' | 'services' | 'serviceArea' | 'audience' | 'tone' | 'toneNotes'>
>

/** The host fields the profile reads. A closed surface, as the host tokens' is. */
export interface BusinessProfileHost {
  displayName?: string
  logoUrl?: string
  seo?: { description?: string; entity?: HostSeoEntity | null } | null
  business?: {
    supportEmail?: string
    address?: string
    socialLinks?: Array<{ label?: string; url?: string } | null> | null
  } | null
}

export interface ResolvedBusinessField<T> {
  value: T
  origin: BusinessProfileOrigin
}

/** The picture every reader works from: each field's value and where it came from. */
export interface ResolvedBusinessProfile {
  name: ResolvedBusinessField<string> | null
  whatYouDo: ResolvedBusinessField<string> | null
  services: ResolvedBusinessField<string[]> | null
  serviceArea: ResolvedBusinessField<string> | null
  audience: ResolvedBusinessField<string> | null
  tone: ResolvedBusinessField<BusinessTone> | null
  toneNotes: ResolvedBusinessField<string> | null
  /** The schema.org business type the SEO entity names, e.g. `Plumber`. */
  businessType: string | null
  /** Real contact details, each only where the owner entered it in the site's settings. */
  contact: {
    email: string | null
    phone: string | null
    address: string | null
    hours: string | null
  }
  /** The site's social and other profiles, https only. */
  profiles: string[]
  logo: string | null
}

const text = (value: unknown, max: number): string =>
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
function fieldValue(doc: BusinessProfileValues | null | undefined, field: BusinessProfileField): unknown {
  switch (field) {
    case 'services':
      return services(doc?.services)
    case 'tone':
      return tone(doc?.tone)
    default:
      return text(doc?.[field], BUSINESS_PROFILE_MAX_CHARS[field])
  }
}

const isEmpty = (value: unknown): boolean =>
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

/** The postal address as one line: the SEO entity's parts, else the contact card's block. */
function addressLine(host: BusinessProfileHost | null | undefined): string {
  const parts = host?.seo?.entity?.address
  const line = [
    parts?.streetAddress,
    parts?.addressLocality,
    parts?.addressRegion,
    parts?.postalCode,
    parts?.addressCountry,
  ]
    .map((part) => text(part, 200))
    .filter(Boolean)
    .join(', ')
  return line || text(host?.business?.address, 400)
}

/**
 * The profile as every reader sees it, field by field (AGL-3661):
 *
 * 1. what the OWNER typed into the site's profile;
 * 2. what the site's own settings say (the SEO entity, the contact card, the
 *    display name), which the owner typed too, elsewhere;
 * 3. what the guided start or a generator stored on the site's profile;
 * 4. the workspace defaults.
 *
 * Contact details, the logo and the profiles come from the site's settings
 * only: nothing but the owner's own entry may say how to reach the business.
 */
export function resolveBusinessProfile(input: {
  host: BusinessProfileHost | null | undefined
  site?: BusinessProfileDoc | null
  workspace?: BusinessProfileDoc | null
}): ResolvedBusinessProfile {
  const { host, site, workspace } = input
  const entity = host?.seo?.entity ?? null
  const fromSite: Partial<Record<BusinessProfileField, unknown>> = {
    whatYouDo: text(entity?.description, BUSINESS_PROFILE_MAX_CHARS.whatYouDo),
    serviceArea: normalizeAreaServed(entity?.areaServed).join(', ').slice(0, BUSINESS_PROFILE_MAX_CHARS.serviceArea),
  }

  const resolve = <T>(field: BusinessProfileField): ResolvedBusinessField<T> | null => {
    const stored = businessProfileSourceOf(site, field)
    if (stored === 'owner') return { value: fieldValue(site, field) as T, origin: 'owner' }
    const own = fromSite[field]
    if (own !== undefined && !isEmpty(own)) return { value: own as T, origin: 'site' }
    if (stored) return { value: fieldValue(site, field) as T, origin: stored }
    if (businessProfileSourceOf(workspace, field)) {
      return { value: fieldValue(workspace, field) as T, origin: 'workspace' }
    }
    return null
  }

  const name = text(entity?.name, 200) || text(host?.displayName, 200)
  return {
    name: name ? { value: name, origin: 'site' } : null,
    whatYouDo: resolve<string>('whatYouDo'),
    services: resolve<string[]>('services'),
    serviceArea: resolve<string>('serviceArea'),
    audience: resolve<string>('audience'),
    tone: resolve<BusinessTone>('tone'),
    toneNotes: resolve<string>('toneNotes'),
    businessType: text(entity?.businessType, 80) || null,
    contact: {
      email: text(entity?.email, 320) || text(host?.business?.supportEmail, 320) || null,
      phone: text(entity?.telephone, 64) || null,
      address: addressLine(host) || null,
      hours: text(entity?.openingHours, 400) || null,
    },
    profiles: siteProfileUrls(host as Parameters<typeof siteProfileUrls>[0]),
    logo: text(host?.logoUrl, 800) || text(entity?.logo, 800) || null,
  }
}

/** Each origin as the profile screen labels it. */
export const BUSINESS_PROFILE_ORIGIN_LABELS: Readonly<Record<BusinessProfileOrigin, string>> = {
  owner: 'You',
  site: 'Site settings',
  start: 'Your answers when the site was started',
  ai: 'Suggested by Aglyn AI',
  workspace: 'Workspace default',
}
