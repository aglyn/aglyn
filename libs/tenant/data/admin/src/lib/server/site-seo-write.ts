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

import { SEO_DESCRIPTION_MAX_LENGTH, SEO_TITLE_MAX_LENGTH } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import {
  SITE_SEO_SEPARATOR_MAX_LENGTH,
  SITE_SEO_TITLE_PATTERN_MAX_LENGTH,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { Firestore } from 'firebase-admin/firestore'
import {
  sameSiteSetting,
  siteSettingAt,
  siteSettingStored,
  type SiteSettingsChange,
  type SiteSettingsWrite,
  writeSiteSettings,
} from './site-settings-write'

/**
 * A SITE'S SEARCH LISTING DEFAULTS SAVED ON THE SERVER (AGL-4235).
 *
 * The four fields of Setup → SEO's base card — the title and description
 * pages without their own fall back to, the separator, and the title
 * pattern — held to the card's own limits and saved as the card saves them:
 * a merge of the paths it owns, and the pattern deleted, not stored blank,
 * when it is emptied (`CLEARABLE_SEO_PATHS`). The card REQUIRES a title, a
 * description and a separator, so those three cannot be emptied here either.
 *
 * Nothing else on `seo` is written: not the search-indexing switch, the
 * verification codes, the AI agents text, the local business fields or the
 * social image.
 */

/** Every member a site search listing write may carry, with its stored path and limit. */
export const SITE_SEO_FIELDS = {
  title: { path: 'seo.title', maxLength: SEO_TITLE_MAX_LENGTH, required: true },
  description: { path: 'seo.description', maxLength: SEO_DESCRIPTION_MAX_LENGTH, required: true },
  separator: { path: 'seo.separator', maxLength: SITE_SEO_SEPARATOR_MAX_LENGTH, required: true },
  titlePattern: { path: 'seo.titlePattern', maxLength: SITE_SEO_TITLE_PATTERN_MAX_LENGTH, required: false },
} as const

export type SiteSeoMember = keyof typeof SITE_SEO_FIELDS

/** A request's members, read. `''` empties the member. */
export type SiteSeoPatch = Partial<Record<SiteSeoMember, string>>

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Reads and checks a site search listing write body. Values are stored as
 * given, as the card stores them; a value of only spaces counts as empty.
 */
export function readSiteSeoPatch(body: unknown): { patch: SiteSeoPatch } | { errors: Record<string, string> } {
  if (!isObject(body)) return { errors: { body: 'Must be a JSON object' } }
  const errors: Record<string, string> = {}
  const patch: SiteSeoPatch = {}
  for (const key of Object.keys(body)) {
    if (!(key in SITE_SEO_FIELDS)) errors[key] = 'Not writable on a site’s search listing'
  }
  for (const [member, field] of Object.entries(SITE_SEO_FIELDS) as Array<[SiteSeoMember, (typeof SITE_SEO_FIELDS)[SiteSeoMember]]>) {
    const value = body[member]
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') {
      errors[member] = field.required ? 'Must be a string' : 'Must be a string, or null to clear it'
      continue
    }
    const text = typeof value === 'string' ? value : ''
    if (!text.trim()) {
      if (field.required) errors[member] = 'Required: it cannot be emptied'
      else patch[member] = ''
      continue
    }
    if (text.length > field.maxLength) {
      errors[member] = `Must be ${field.maxLength} characters or fewer`
      continue
    }
    patch[member] = text
  }
  return Object.keys(errors).length ? { errors } : { patch }
}

/** The changes a write asks of the stored host: only paths that differ. */
export function siteSeoChanges(stored: Record<string, unknown>, patch: SiteSeoPatch): SiteSettingsChange[] {
  const changes: SiteSettingsChange[] = []
  for (const [member, value] of Object.entries(patch) as Array<[SiteSeoMember, string]>) {
    const { path } = SITE_SEO_FIELDS[member]
    const before = siteSettingAt(stored, path)
    if (!value) {
      if (siteSettingStored(before)) changes.push({ path, remove: true })
      continue
    }
    if (!sameSiteSetting(value, before)) changes.push({ path, value })
  }
  return changes
}

/** A site's search listing as the API publishes it. */
export function siteSeoView(hostId: string, stored: Record<string, unknown> | null | undefined) {
  const text = (path: string): string | null => {
    const value = siteSettingAt(stored, path)
    return typeof value === 'string' && value !== '' ? value : null
  }
  return {
    object: 'site_seo' as const,
    site: hostId,
    title: text('seo.title'),
    description: text('seo.description'),
    separator: text('seo.separator'),
    titlePattern: text('seo.titlePattern'),
    image: text('seo.image'),
    imageAlt: text('seo.imageAlt'),
  }
}

/** Saves a site's search listing through the shared site-settings writer. */
export function writeSiteSeo(
  firestore: Firestore,
  input: { hostId: string; patch: SiteSeoPatch; now: Date },
): Promise<SiteSettingsWrite<never>> {
  return writeSiteSettings<never>(firestore, {
    hostId: input.hostId,
    now: input.now,
    plan: (host) => ({ changes: siteSeoChanges(host, input.patch) }),
  })
}
