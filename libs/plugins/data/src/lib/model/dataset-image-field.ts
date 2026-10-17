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

import { MEDIA_CDN_ROUTE, mediaRefFromCdnPath, parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import type { CustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A RECORD'S PHOTO (AGL-3616): the "Image" field type, riding `text` storage.
 *
 * A portfolio's pieces, a team, a menu, a studio's classes are lists a
 * visitor looks at before reading, so their records carry a photo, and the
 * page that repeats over them binds it as an Image's `src`
 * (`{{item.<field>}}`). The value is an address the site's own Image element
 * shows: the media library's CDN path (`/api/media/cdn/{scope}/{mediaId}`,
 * the form a picker writes into a product), a `media:` reference, another
 * path on the site, or an https address. Nothing else is a picture a page can
 * draw, so nothing else is stored.
 *
 * A `media:` reference is read by `parseMediaRef`, the grammar that minted
 * it, so a photo from the organization library (`media:org:{orgId}/{id}`,
 * whose scope holds a colon) and a content-pinned one (`…@{hash}`) are the
 * same photo as a site's own (AGL-3763).
 */

/** The custom field type a record's photo rides. Persisted on field definitions — never rename. */
export const DATASET_IMAGE_FIELD_TYPE = 'image'

/** The longest photo address kept. */
export const DATASET_IMAGE_VALUE_MAX = 2_000

/** Whether a value is a photo address a record may hold. */
export function isDatasetImageValue(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > DATASET_IMAGE_VALUE_MAX) return false
  if (/[\s"'<>\\]/.test(value)) return false
  if (value.startsWith('media:')) return parseMediaRef(value) !== null
  if (value.startsWith('/')) return !value.startsWith('//')
  return /^https:\/\/[^/]+/.test(value)
}

/**
 * The site whose own media library a photo address is in (AGL-3912): the
 * `{hostId}` scope of a site-relative CDN path (`/api/media/cdn/{hostId}/…`)
 * or of a `media:{hostId}/…` reference. `null` for an organization-library
 * photo (`org:…`), which outlives any one site, and for any other address.
 */
export function datasetImageSiteOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ref = value.startsWith('media:')
    ? parseMediaRef(value)
    : value.startsWith(`${MEDIA_CDN_ROUTE}/`)
      ? parseMediaRef(mediaRefFromCdnPath(value))
      : null
  return ref && !ref.scope.startsWith('org:') ? ref.scope : null
}

/**
 * The sites a record's photos are in the libraries of (AGL-3912), by host id:
 * every value of the record that is a site-library photo
 * ({@link datasetImageSiteOf}).
 */
export function datasetRecordPhotoSites(record: Readonly<Record<string, unknown>>): string[] {
  const sites = new Set<string>()
  for (const value of Object.values(record)) {
    const site = datasetImageSiteOf(value)
    if (site) sites.add(site)
  }
  return [...sites]
}

/**
 * A record without the photos whose site no longer exists (AGL-3912). A
 * site's library goes with the site, so such a photo answers 404 under
 * every address, and a page would draw it broken. The field is left out
 * instead, as a record that never had a photo: a published page prints
 * nothing for it, and a card binding it as its picture leaves the picture
 * out. Returns the record itself when it holds none.
 */
export function datasetRecordWithoutGonePhotos<T extends Readonly<Record<string, unknown>>>(
  record: T,
  goneSites: ReadonlySet<string>,
): T {
  if (!goneSites.size) return record
  const gone = Object.entries(record).filter(([, value]) => {
    const site = datasetImageSiteOf(value)
    return site !== null && goneSites.has(site)
  })
  if (!gone.length) return record
  const next: Record<string, unknown> = { ...record }
  for (const [key] of gone) delete next[key]
  return next as T
}

export const DATASET_IMAGE_FIELD: CustomFieldType = {
  name: DATASET_IMAGE_FIELD_TYPE,
  pluginId: BUNDLE_ID,
  label: 'Image',
  baseType: 'text',
  description: 'A photo from the media library, or an https link to one',
  validate: (value) => (isDatasetImageValue(value) ? null : 'Use a photo from the media library or an https link'),
}
