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
  SCREEN_LINK_VALUE_PREFIX,
  formatScreenLinkValue,
  linkTargetKind,
  parseScreenLinkValue,
} from '@aglyn/aglyn/app-utils/screen-link-value'
import type { CustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A RECORD'S PAGE (AGL-3763): the "Page" field type, riding `text` storage.
 *
 * A service, a location or a team member often has a page of its own that
 * was built as an ordinary page, and the list that repeats over the records
 * links each card to it. The owner picks that page from the site's pages;
 * nobody types an address.
 *
 * The value is the page's link reference, `screen:{screenId}` — the form the
 * Besigner's own page pickers write into a `Link` prop. Every linking element
 * already resolves that form from either of its link slots through the
 * routing map (`splitLinkValue`), so a Button whose link is
 * `{{item.<field>}}` follows the page to its CURRENT address: renaming the
 * page or moving it under another one never breaks the records that name it.
 * A bare id would not do — in an href slot it reads as a relative path.
 */

/** The custom field type a record's page rides. Persisted on field definitions — never rename. */
export const DATASET_PAGE_FIELD_TYPE = 'page'

/** A screen id as the console mints them: one path-free segment. */
const SCREEN_ID = /^[A-Za-z0-9_-]{1,128}$/

/** The page a stored value names, or undefined when it names none. */
export function datasetPageScreenId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(SCREEN_LINK_VALUE_PREFIX)) return undefined
  const key = parseScreenLinkValue(value)
  if (!key || linkTargetKind(key) !== 'screen' || !SCREEN_ID.test(key)) return undefined
  return key
}

/** Whether a value is a page reference a record may hold, exactly as stored. */
export function isDatasetPageValue(value: unknown): value is string {
  const screenId = datasetPageScreenId(value)
  return screenId !== undefined && value === datasetPageValue(screenId)
}

/** The stored form of a picked page. */
export function datasetPageValue(screenId: string): string {
  return formatScreenLinkValue(screenId)
}

export const DATASET_PAGE_FIELD: CustomFieldType = {
  name: DATASET_PAGE_FIELD_TYPE,
  pluginId: BUNDLE_ID,
  label: 'Page',
  baseType: 'text',
  description: 'One of the site’s pages, picked from a list — a link to it follows the page wherever it moves',
  validate: (value) => (isDatasetPageValue(value) ? null : 'Pick one of the site’s pages'),
}
