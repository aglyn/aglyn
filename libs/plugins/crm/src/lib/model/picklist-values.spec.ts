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
  type CrmPicklist,
  type CrmPicklistDefinition,
  crmPicklistDefinition,
  effectiveCrmLeadSourcePicklist,
  effectiveCrmLeadStatusPicklist,
} from '@aglyn/aglyn/app-utils/crm'
import {
  addPicklistValue,
  deletePicklistValue,
  movePicklistValue,
  picklistAddableMeanings,
  picklistMeaningLabel,
  picklistReplacements,
  renamePicklistValue,
  setPicklistDefault,
  setPicklistValueActive,
  setPicklistValueGroup,
  sortPicklistValues,
} from './picklist-values'

const LEAD_SOURCE = crmPicklistDefinition('leadSource') as CrmPicklistDefinition

/** A definition with meanings, as a status field declares one — only here, until one is registered. */
const STATUS: CrmPicklistDefinition = {
  id: 'testStatus',
  label: 'Status',
  plural: 'statuses',
  object: 'lead',
  restricted: true,
  meanings: ['open', 'closed'],
  standardValues: [
    { id: 'open', label: 'Open', meaning: 'open' },
    { id: 'closed', label: 'Closed', meaning: 'closed' },
  ],
  targets: [{ object: 'lead', field: 'status' }],
}

const LIST: CrmPicklist = {
  values: [
    { id: 'web', label: 'Website form', active: true },
    { id: 'apollo', label: 'Outbound · Apollo', active: true },
    { id: 'old', label: 'Old list', active: false },
  ],
  defaultValueId: 'web',
}
const labels = (picklist: CrmPicklist) => picklist.values.map((value) => value.label)

describe('the picklist moves (AGL-3298, AGL-3510)', () => {
  it('adds a value last, refusing a label the list already holds in any case', () => {
    const added = addPicklistValue(LEAD_SOURCE, LIST, '  Referral ', { group: 'inbound' })
    expect(added.ok && added.picklist.values.at(-1)).toEqual({
      id: 'referral',
      label: 'Referral',
      active: true,
      group: 'inbound',
    })
    expect(addPicklistValue(LEAD_SOURCE, LIST, 'website FORM')).toEqual({
      ok: false,
      error: '“Website form” is already in the list.',
    })
    expect(addPicklistValue(LEAD_SOURCE, LIST, 'old list')).toMatchObject({ ok: false, error: /activate it/ })
    expect(addPicklistValue(LEAD_SOURCE, LIST, '  ')).toMatchObject({ ok: false })
    // An unknown group files it under none.
    const ungrouped = addPicklistValue(LEAD_SOURCE, LIST, 'Podcast', { group: 'sideways' })
    expect(ungrouped.ok && ungrouped.picklist.values.at(-1)?.group).toBeNull()
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
    const list: CrmPicklist = { ...LIST, defaultValueId: 'apollo' }
    const cleared = deletePicklistValue(LEAD_SOURCE, list, 'apollo', null)
    expect(cleared.ok && cleared.picklist).toEqual({
      values: [LIST.values[0], LIST.values[2]],
      defaultValueId: null,
    })
    expect(deletePicklistValue(LEAD_SOURCE, LIST, 'old', 'outbound · apollo').ok).toBe(true)
    expect(deletePicklistValue(LEAD_SOURCE, LIST, 'apollo', 'Old list')).toMatchObject({ ok: false })
    expect(deletePicklistValue(LEAD_SOURCE, LIST, 'apollo', 'Outbound · Apollo')).toMatchObject({
      ok: false,
    })
  })

  it('refuses to delete a standard value, however it was relabeled, and offers deactivating it', () => {
    expect(deletePicklistValue(LEAD_SOURCE, LIST, 'web', null)).toEqual({
      ok: false,
      error: '“Website form” is a standard value and cannot be deleted. Deactivate it instead.',
    })
    const standard = effectiveCrmLeadSourcePicklist(null)
    for (const value of standard.values) {
      expect(deletePicklistValue(LEAD_SOURCE, standard, value.id, null).ok).toBe(false)
    }
    expect(setPicklistValueActive(standard, 'web', false).values[0].active).toBe(false)
  })

  it('mints an added value’s id clear of every standard id, even one the list does not show', () => {
    const added = addPicklistValue(LEAD_SOURCE, { values: [], defaultValueId: null }, 'Webinar')
    expect(added.ok && added.picklist.values[0].id).toBe('webinar-2')
  })

  it('moves a deleted value’s records only to a value of the same meaning', () => {
    const list: CrmPicklist = {
      values: [
        { id: 'open', label: 'Open', active: true, meaning: 'open' },
        { id: 'closed', label: 'Closed', active: true, meaning: 'closed' },
        { id: 'nurture', label: 'Nurture', active: true, meaning: 'open' },
      ],
      defaultValueId: null,
    }
    expect(deletePicklistValue(STATUS, list, 'nurture', 'Open').ok).toBe(true)
    expect(deletePicklistValue(STATUS, list, 'nurture', 'Closed')).toEqual({
      ok: false,
      error: 'Pick a value that means the same as “Nurture” to move its records to.',
    })
    expect(picklistReplacements(STATUS, list, 'nurture').map((value) => value.id)).toEqual(['open'])
    // Without meanings every other active value is a replacement.
    expect(picklistReplacements(LEAD_SOURCE, LIST, 'web').map((value) => value.id)).toEqual(['apollo'])
    // An added value on such a definition must say what it means.
    expect(addPicklistValue(STATUS, list, 'Parked')).toEqual({ ok: false, error: 'Pick what the value means.' })
    const parked = addPicklistValue(STATUS, list, 'Parked', { meaning: 'closed' })
    expect(parked.ok && parked.picklist.values.at(-1)).toEqual({
      id: 'parked',
      label: 'Parked',
      active: true,
      meaning: 'closed',
    })
  })

  it('files a value under a known group, or none', () => {
    expect(setPicklistValueGroup(LEAD_SOURCE, LIST, 'web', 'outbound').values[0].group).toBe('outbound')
    expect(setPicklistValueGroup(LEAD_SOURCE, LIST, 'web', 'nope').values[0].group).toBeNull()
    expect(setPicklistValueGroup(LEAD_SOURCE, LIST, 'web', null).values[1]).toBe(LIST.values[1])
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

describe('the lead status picklist’s values (AGL-3512)', () => {
  const LEAD_STATUS = crmPicklistDefinition('leadStatus') as CrmPicklistDefinition
  const list = effectiveCrmLeadStatusPicklist({
    values: [{ id: 'contacted', label: 'Contacted', active: true, meaning: 'working' }],
    defaultValueId: null,
  })

  it('offers every meaning but Qualified to an added value, by its label', () => {
    expect(picklistAddableMeanings(LEAD_STATUS)).toEqual(['new', 'nurturing', 'working', 'unqualified'])
    expect(picklistMeaningLabel(LEAD_STATUS, 'nurturing')).toBe('Nurturing')
    const refused = addPicklistValue(LEAD_STATUS, list, 'Won', { meaning: 'qualified' })
    expect(refused).toEqual({ ok: false, error: 'Only the platform sets Qualified; pick another meaning.' })
    expect(addPicklistValue(LEAD_STATUS, list, 'Meeting set', { meaning: 'working' }).ok).toBe(true)
  })

  it('refuses a delete that would clear its leads, and moves them only within the meaning', () => {
    expect(deletePicklistValue(LEAD_STATUS, list, 'contacted', null)).toEqual({
      ok: false,
      error: 'Pick a value that means the same as “Contacted” to move its records to.',
    })
    expect(deletePicklistValue(LEAD_STATUS, list, 'contacted', 'New').ok).toBe(false)
    expect(deletePicklistValue(LEAD_STATUS, list, 'contacted', 'working').ok).toBe(true)
    expect(picklistReplacements(LEAD_STATUS, list, 'contacted').map((value) => value.label)).toEqual([
      'Working',
    ])
  })
})
