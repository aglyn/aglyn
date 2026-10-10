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
 */

/** The custom field type a record's photo rides. Persisted on field definitions — never rename. */
export const DATASET_IMAGE_FIELD_TYPE = 'image'

/** The longest photo address kept. */
export const DATASET_IMAGE_VALUE_MAX = 2_000

const MEDIA_REF = /^media:[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:@[A-Za-z0-9]+)?$/

/** Whether a value is a photo address a record may hold. */
export function isDatasetImageValue(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > DATASET_IMAGE_VALUE_MAX) return false
  if (/[\s"'<>\\]/.test(value)) return false
  if (value.startsWith('media:')) return MEDIA_REF.test(value)
  if (value.startsWith('/')) return !value.startsWith('//')
  return /^https:\/\/[^/]+/.test(value)
}

export const DATASET_IMAGE_FIELD: CustomFieldType = {
  name: DATASET_IMAGE_FIELD_TYPE,
  pluginId: BUNDLE_ID,
  label: 'Image',
  baseType: 'text',
  description: 'A photo from the media library, or an https link to one',
  validate: (value) => (isDatasetImageValue(value) ? null : 'Use a photo from the media library or an https link'),
}
