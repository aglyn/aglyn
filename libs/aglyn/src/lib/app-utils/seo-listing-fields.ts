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

import { MEDIA_ALT_MAX_LENGTH } from './media-alt'
import { SCREEN_SEO_TEXT_FIELDS, SCREEN_SEO_TEXT_GUIDANCE } from './screen-seo-fields'

/**
 * The fields of a search listing: what a search result and a share card say
 * about one page or one product, and how long each may be.
 *
 * One catalog, because more than one surface edits these and more than one
 * reader holds them to a length. The screen detail page's SEO card draws its
 * inputs from it, the besigner's SEO panel shares the counts, the commerce
 * product editor labels its search engine listing with it, and anything that
 * proposes a value — a template, an import, a generator — reads the same
 * limits the editor enforces instead of restating them. A limit written in
 * two places is a limit the two places disagree about the first time one of
 * them changes.
 *
 * The lengths are what a search result shows before it truncates: about 60
 * characters of a title and 155 of a description. A breadcrumb label is the
 * page's short name in a trail, so it is held shorter than the title it
 * usually abbreviates. The image description is an `alt`, and takes the
 * platform's one `alt` ceiling.
 */

/** Every field a search listing editor may hold. */
export type SeoListingFieldKey = 'title' | 'description' | 'breadcrumb' | 'imageAlt'

export interface SeoListingFieldDefinition {
  key: SeoListingFieldKey
  /** The input's label, as the editors draw it. */
  label: string
  /** The longest value the editor accepts; a longer one is flagged, not trimmed. */
  maxLength: number
  /** Drawn as a multi-line input. */
  multiline?: boolean
  /** What the value is FOR, in a sentence an author or a generator can act on. */
  purpose: string
}

/** A breadcrumb label: the page's short name in a trail. */
export const SEO_BREADCRUMB_MAX_LENGTH = 40

export const SEO_LISTING_FIELDS: Readonly<Record<SeoListingFieldKey, SeoListingFieldDefinition>> = {
  title: {
    key: 'title',
    label: 'Title',
    maxLength: SCREEN_SEO_TEXT_GUIDANCE.title,
    purpose:
      'The headline of the search result, published exactly as written; the site title is not appended to it.',
  },
  description: {
    key: 'description',
    label: 'Description',
    maxLength: SCREEN_SEO_TEXT_GUIDANCE.description,
    multiline: true,
    purpose: 'The summary a search result shows under the headline.',
  },
  breadcrumb: {
    key: 'breadcrumb',
    label: 'Breadcrumb label',
    maxLength: SEO_BREADCRUMB_MAX_LENGTH,
    purpose: 'The short name of the page where a breadcrumb trail names it.',
  },
  imageAlt: {
    key: 'imageAlt',
    label: 'Image description',
    maxLength: MEDIA_ALT_MAX_LENGTH,
    multiline: true,
    purpose:
      'What the social image shows, read aloud in a share preview. It describes the picture, not the page.',
  },
}

/**
 * The fields the screen detail page's SEO card edits, in the order it draws
 * them. `imageAlt` is the social image's own description and is only editable
 * beside an image, which the card enforces.
 */
export const SCREEN_SEO_LISTING_FIELDS: readonly SeoListingFieldKey[] = [
  'title',
  'description',
  'breadcrumb',
  'imageAlt',
]

/**
 * The screen card's plain text inputs: every field but the image's
 * description. The listing's own title and description are the besigner's
 * `SCREEN_SEO_TEXT_FIELDS`; the card adds the breadcrumb label beside them.
 */
export const SCREEN_SEO_CARD_TEXT_FIELDS = [...SCREEN_SEO_TEXT_FIELDS, 'breadcrumb'] as const

export type ScreenSeoCardTextField = (typeof SCREEN_SEO_CARD_TEXT_FIELDS)[number]

/** Whether a string names a field of the catalog. */
export function isSeoListingFieldKey(value: unknown): value is SeoListingFieldKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SEO_LISTING_FIELDS, value)
}

/** A field's counter text, `12/60`, as every editor prints it. */
export function seoListingFieldCount(key: SeoListingFieldKey, value: string | null | undefined): string {
  return `${String(value ?? '').length}/${SEO_LISTING_FIELDS[key].maxLength}`
}

/** Whether a value is over its field's length. */
export function seoListingFieldTooLong(key: SeoListingFieldKey, value: string | null | undefined): boolean {
  return String(value ?? '').length > SEO_LISTING_FIELDS[key].maxLength
}
