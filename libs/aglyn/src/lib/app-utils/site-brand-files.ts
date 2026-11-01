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

import { normalizeImageContentType } from './image-upload-types'
import { mediaNodeSrc } from './media-ref'

/**
 * The logo, the dark logo and the favicon a new site is created with
 * (AGL-4119).
 *
 * A first-time account has no workspace until the create makes one, so nothing
 * can go into a library while the form is open. The form holds the files, and
 * they go into the new site's own library once it exists. The site is what the
 * person asked for and these are optional, so a file that does not make it
 * never costs them the site: they are told which, and where to add it.
 */

/** One of the three fields, and the host field each is written to. */
export type SiteBrandSlot = 'logo' | 'logoDark' | 'favicon'

export interface SiteBrandSlotSpec {
  slot: SiteBrandSlot
  /** The field's label. */
  label: string
  /** How a sentence names it. */
  noun: string
}

export const SITE_BRAND_SLOTS: readonly SiteBrandSlotSpec[] = [
  { slot: 'logo', label: 'Logo', noun: 'logo' },
  { slot: 'logoDark', label: 'Logo for dark backgrounds', noun: 'dark logo' },
  { slot: 'favicon', label: 'Favicon', noun: 'favicon' },
]

/** The types a logo may be, with the names a file with no type is read from. */
const LOGO_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
}

/**
 * What a favicon may also be. An `.ico` is linked as it is, and never reaches
 * a logo slot: the file a header draws has to be a picture any size can use.
 */
const FAVICON_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  ...LOGO_FILE_TYPES,
  'image/x-icon': ['.ico'],
  'image/vnd.microsoft.icon': ['.ico'],
}

const typesFor = (slot: SiteBrandSlot) => (slot === 'favicon' ? FAVICON_FILE_TYPES : LOGO_FILE_TYPES)

/** The file chooser's `accept` for a field. */
export function siteBrandFileAccept(slot: SiteBrandSlot): string {
  return Object.entries(typesFor(slot))
    .flatMap(([type, extensions]) => [type, ...extensions])
    .join(',')
}

/**
 * The content type to upload a file under, or `null` for one the field does
 * not take. Read off the file's name when the browser reports none, because
 * the upload route refuses an empty type.
 */
export function siteBrandFileType(
  file: Pick<File, 'name' | 'type'>,
  slot: SiteBrandSlot,
): string | null {
  const types = typesFor(slot)
  const reported = normalizeImageContentType(file.type)
  if (reported) return types[reported] ? reported : null
  const name = file.name.toLowerCase()
  const match = Object.entries(types).find(([, extensions]) =>
    extensions.some((extension) => name.endsWith(extension)),
  )
  return match ? match[0] : null
}

/**
 * Why a field will not take this file, said on the field before anything is
 * created, or `null` when it will. `maxBytes` is the upload route's ceiling.
 */
export function siteBrandFileRefusal(
  file: Pick<File, 'name' | 'type' | 'size'>,
  slot: SiteBrandSlot,
  maxBytes: number,
): string | null {
  if (!siteBrandFileType(file, slot)) {
    return slot === 'favicon' ? 'Use a PNG, JPEG, WebP, SVG or ICO file.' : 'Use a PNG, JPEG, WebP or SVG file.'
  }
  if (!file.size) return 'That file is empty.'
  if (file.size > maxBytes) return `That file is over ${Math.round(maxBytes / (1024 * 1024))} MB.`
  return null
}

/** The host fields a create writes; `favicon` lands on `seo.favicon`. */
export interface SiteBrandFields {
  logoUrl?: string
  logoDarkUrl?: string
  favicon?: string
}

export interface SiteBrandSaveOutcome {
  /** What was written; `null` when nothing was. */
  saved: SiteBrandFields | null
  /** The chosen files that did not make it, in field order. */
  missed: SiteBrandSlot[]
}

/**
 * Uploads the files a form is holding and writes what they became, one after
 * the other so the storage count stays right. Never rejects: each failure is
 * reported in `missed`.
 *
 * Each field stores `mediaNodeSrc`, as the Site settings cards do. A favicon
 * left blank is the logo, the same asset rather than a second copy, and with
 * no logo and no favicon nothing is written.
 */
export async function saveSiteBrandFiles(
  files: Readonly<Partial<Record<SiteBrandSlot, File | null>>>,
  io: {
    upload: (file: File, slot: SiteBrandSlot) => Promise<{ url?: string | null; cdnPath?: string | null }>
    save: (fields: SiteBrandFields) => Promise<void>
  },
): Promise<SiteBrandSaveOutcome> {
  const stored: Partial<Record<SiteBrandSlot, string>> = {}
  const missed: SiteBrandSlot[] = []
  for (const { slot } of SITE_BRAND_SLOTS) {
    const file = files[slot]
    if (!file) continue
    try {
      const src = mediaNodeSrc(await io.upload(file, slot))
      if (src) stored[slot] = src
      else missed.push(slot)
    } catch {
      missed.push(slot)
    }
  }
  const favicon = stored.favicon ?? stored.logo
  const fields: SiteBrandFields = {
    ...(stored.logo ? { logoUrl: stored.logo } : {}),
    ...(stored.logoDark ? { logoDarkUrl: stored.logoDark } : {}),
    ...(favicon ? { favicon } : {}),
  }
  if (!Object.keys(fields).length) return { saved: null, missed }
  try {
    await io.save(fields)
    return { saved: fields, missed }
  } catch {
    // Every file is in the library, and nothing points at any of them.
    return {
      saved: null,
      missed: SITE_BRAND_SLOTS.map(({ slot }) => slot).filter((slot) => Boolean(files[slot])),
    }
  }
}

/** The one line that says which files did not make it, or `null` when all did. */
export function siteBrandMissedNotice(missed: readonly SiteBrandSlot[]): string | null {
  const nouns = SITE_BRAND_SLOTS.filter(({ slot }) => missed.includes(slot)).map(({ noun }) => noun)
  if (!nouns.length) return null
  const list = nouns.length > 1 ? `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}` : nouns[0]
  return (
    `Your site is ready, but your ${list} didn’t upload. ` +
    `Add ${nouns.length > 1 ? 'them' : 'it'} in Site settings.`
  )
}

/**
 * The query that carries {@link SiteBrandSaveOutcome.missed} over a full page
 * load: a site made on the auth host lands on the console host, and a notice
 * shown on the way out would go with the page. Field names only.
 */
export const SITE_BRAND_MISSED_PARAM = 'missed'

/** The fields a landing's {@link SITE_BRAND_MISSED_PARAM} names. Anything else is dropped. */
export function readSiteBrandMissed(value: string | null | undefined): SiteBrandSlot[] {
  const named = String(value ?? '').split(',')
  return SITE_BRAND_SLOTS.map(({ slot }) => slot).filter((slot) => named.includes(slot))
}
