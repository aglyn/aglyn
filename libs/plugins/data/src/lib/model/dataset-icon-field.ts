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

import { RECORD_ICON_FIELD_TYPE } from '@aglyn/aglyn/app-utils/binding-token-catalog'
import type { CustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A RECORD'S ICON (AGL-4190): the "Icon" field type, riding `map` storage.
 *
 * A list of integrations, services or perks shows each one with its own icon,
 * so the page that repeats over the records binds an Icon element to a field.
 * A published page never loads the icon catalog (AGL-1212: it is ~2.9 MB), so
 * an icon NAME alone draws nothing there. The record therefore keeps what an
 * Icon element keeps when its icon is picked in the Besigner: the icon's id
 * and its SVG path, written together at the moment of the pick, when the
 * record editor's picker has the catalog loaded.
 *
 * Stored as `{ iconId, iconPath }`, the same shape a reusable component's
 * Icon property holds (`ReusableComponentIcon`), so one icon value means one
 * thing everywhere. A repeat reads `{{item.<field>}}` as the icon's id and
 * `{{item.<field>.iconPath}}` as its path.
 */

/** The custom field type a record's icon rides. Persisted on field definitions — never rename. */
export const DATASET_ICON_FIELD_TYPE = RECORD_ICON_FIELD_TYPE

/** An icon a record holds. */
export interface DatasetIconValue {
  iconId: string
  iconPath?: string
}

/** The longest icon id kept: the library's longest is under 50 characters. */
const ICON_ID_MAX = 100
/** The longest path kept: the library's longest is under 6,000 characters. */
const ICON_PATH_MAX = 20_000
/** An icon id as the library names them: `bucket-outline`, `numeric-1-box`. */
const ICON_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** SVG path data: commands, numbers, separators. Nothing that could be markup. */
const ICON_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/

/**
 * The icon a stored value holds, or `undefined` for anything else.
 *
 * A JSON string is read too, because the record editor hands values over in
 * their input form and the import wizard reads a CSV cell as text.
 */
export function readDatasetIconValue(value: unknown): DatasetIconValue | undefined {
  let parsed = value
  if (typeof parsed === 'string') {
    const text = parsed.trim()
    if (!text.startsWith('{')) return undefined
    try {
      parsed = JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const { iconId, iconPath } = parsed as Record<string, unknown>
  if (typeof iconId !== 'string' || !iconId || iconId.length > ICON_ID_MAX || !ICON_ID_PATTERN.test(iconId)) {
    return undefined
  }
  if (iconPath === undefined || iconPath === null || iconPath === '') return { iconId }
  if (typeof iconPath !== 'string' || iconPath.length > ICON_PATH_MAX || !ICON_PATH_PATTERN.test(iconPath)) {
    return undefined
  }
  return { iconId, iconPath }
}

/** Whether a value is an icon a record may hold. */
export function isDatasetIconValue(value: unknown): boolean {
  return readDatasetIconValue(value) !== undefined
}

/** An icon id as a person reads it: `bucket-outline` → "Bucket outline". */
export function datasetIconLabel(iconId: string): string {
  const words = iconId.replace(/-/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : iconId
}

export const DATASET_ICON_FIELD: CustomFieldType = {
  name: DATASET_ICON_FIELD_TYPE,
  pluginId: BUNDLE_ID,
  label: 'Icon',
  baseType: 'map',
  description: 'An icon from the library, for an Icon element on a page to show',
  validate: (value) => (isDatasetIconValue(value) ? null : 'Pick an icon from the library'),
}
