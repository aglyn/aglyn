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

import type { CrmPicklist } from '@aglyn/aglyn/app-utils/crm'
import {
  addPicklistValue,
  deletePicklistValue,
  movePicklistValue,
  renamePicklistValue,
  setPicklistDefault,
  setPicklistValueActive,
  sortPicklistValues,
} from './lead-source-values'

const LIST: CrmPicklist = {
  values: [
    { id: 'web', label: 'Website form', active: true },
    { id: 'apollo', label: 'Outbound · Apollo', active: true },
    { id: 'old', label: 'Old list', active: false },
  ],
  defaultValueId: 'web',
}
const labels = (picklist: CrmPicklist) => picklist.values.map((value) => value.label)

describe('the lead source list moves (AGL-3298)', () => {
  it('adds a value last, refusing a label the list already holds in any case', () => {
    const added = addPicklistValue(LIST, '  Referral ')
    expect(added.ok && added.picklist.values.at(-1)).toEqual({
      id: 'referral',
      label: 'Referral',
      active: true,
    })
    expect(addPicklistValue(LIST, 'website FORM')).toEqual({
      ok: false,
      error: '“Website form” is already in the list.',
    })
    expect(addPicklistValue(LIST, 'old list')).toMatchObject({ ok: false, error: /activate it/ })
    expect(addPicklistValue(LIST, '  ')).toMatchObject({ ok: false })
  })

  it('renames a value in place, keeping its id, and refuses a clash with another', () => {
    const renamed = renamePicklistValue(LIST, 'apollo', 'Apollo')
    expect(renamed.ok && renamed.picklist.values[1]).toEqual({
      id: 'apollo',
      label: 'Apollo',
      active: true,
    })
    // A change of case is a rename of the value to itself, and allowed.
    expect(renamePicklistValue(LIST, 'web', 'WEBSITE FORM').ok).toBe(true)
    expect(renamePicklistValue(LIST, 'apollo', 'website form')).toMatchObject({ ok: false })
    expect(renamePicklistValue(LIST, 'gone', 'X')).toMatchObject({ ok: false })
  })

  it('deletes a value onto another ACTIVE value or none, clearing a default it held', () => {
    const cleared = deletePicklistValue(LIST, 'web', null)
    expect(cleared.ok && cleared.picklist).toEqual({
      values: [LIST.values[1], LIST.values[2]],
      defaultValueId: null,
    })
    expect(deletePicklistValue(LIST, 'old', 'outbound · apollo').ok).toBe(true)
    expect(deletePicklistValue(LIST, 'web', 'Old list')).toMatchObject({ ok: false })
    expect(deletePicklistValue(LIST, 'web', 'Website form')).toMatchObject({ ok: false })
  })

  it('deactivates, clearing the default it held, and only makes an active value the default', () => {
    expect(setPicklistValueActive(LIST, 'web', false).defaultValueId).toBeNull()
    expect(setPicklistValueActive(LIST, 'old', true).values[2].active).toBe(true)
    expect(setPicklistDefault(LIST, 'apollo').defaultValueId).toBe('apollo')
    expect(setPicklistDefault(LIST, 'old').defaultValueId).toBeNull()
    expect(setPicklistDefault(LIST, null).defaultValueId).toBeNull()
  })

  it('moves one value, and sorts the whole list A–Z', () => {
    expect(labels(movePicklistValue(LIST, 2, 0))).toEqual([
      'Old list',
      'Website form',
      'Outbound · Apollo',
    ])
    expect(movePicklistValue(LIST, 0, 9)).toBe(LIST)
    expect(labels(sortPicklistValues(LIST))).toEqual([
      'Old list',
      'Outbound · Apollo',
      'Website form',
    ])
  })
})
