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

import { validateCustomFieldValue, registerCustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  DATASET_ICON_FIELD,
  DATASET_ICON_FIELD_TYPE,
  datasetIconLabel,
  isDatasetIconValue,
  readDatasetIconValue,
} from './dataset-icon-field'

/** A record's icon (AGL-4190): the id and path an Icon element binds. */
describe('dataset icon field', () => {
  const PATH = 'M4,4H20V20H4Z'

  it('reads a stored icon and its JSON input form alike', () => {
    expect(readDatasetIconValue({ iconId: 'bucket-outline', iconPath: PATH })).toEqual({
      iconId: 'bucket-outline',
      iconPath: PATH,
    })
    expect(readDatasetIconValue(JSON.stringify({ iconId: 'numeric-1-box', iconPath: PATH }))).toEqual({
      iconId: 'numeric-1-box',
      iconPath: PATH,
    })
    // A pick made before the catalog answered keeps its id.
    expect(readDatasetIconValue({ iconId: 'home' })).toEqual({ iconId: 'home' })
  })

  it('refuses anything that is not an icon from the library', () => {
    expect(isDatasetIconValue('bucket-outline')).toBe(false)
    expect(isDatasetIconValue({ iconId: 'Bucket Outline' })).toBe(false)
    expect(isDatasetIconValue({ iconId: 'home', iconPath: '<script>' })).toBe(false)
    expect(isDatasetIconValue({ iconId: 'home', iconPath: 'M0 0" onload="x' })).toBe(false)
    expect(isDatasetIconValue([{ iconId: 'home' }])).toBe(false)
    expect(isDatasetIconValue('{not json')).toBe(false)
  })

  it('is validated as a custom field riding map storage', () => {
    expect(DATASET_ICON_FIELD.name).toBe(DATASET_ICON_FIELD_TYPE)
    expect(DATASET_ICON_FIELD.baseType).toBe('map')
    registerCustomFieldType(DATASET_ICON_FIELD)
    expect(validateCustomFieldValue('icon', { iconId: 'home', iconPath: PATH })).toBeNull()
    expect(validateCustomFieldValue('icon', { iconId: 'Not an icon' })).toBe('Pick an icon from the library')
    // Empty stays the optional field's business.
    expect(validateCustomFieldValue('icon', '')).toBeNull()
  })

  it('names an icon in words', () => {
    expect(datasetIconLabel('bucket-outline')).toBe('Bucket outline')
  })
})
