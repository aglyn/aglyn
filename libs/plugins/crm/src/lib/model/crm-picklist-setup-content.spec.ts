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

/**
 * Values added to a CRM picklist (AGL-3756), as the Fields page's Add value
 * and a Choice field's choices add them: read, then planned against the
 * list, only ever adding.
 */

import { type CrmPicklistDefinition, crmPicklistDefinition, effectiveCrmPicklist } from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_PICKLIST_VALUES_SETUP_MAX,
  checkCrmPicklistValuesSetup,
  planCrmCustomChoiceValues,
  planCrmPicklistValues,
  readCrmPicklistValuesSetup,
} from './crm-picklist-setup-content'
import { CRM_FIELD_OPTIONS_MAX, type CrmFieldDefinitionDoc } from './crm-setup-content'

const definitionOf = (id: string) => crmPicklistDefinition(id) as CrmPicklistDefinition

describe('reading an ask', () => {
  it('normalizes and de-duplicates the values without capitals', () => {
    expect(readCrmPicklistValuesSetup({ list: 'opportunityType', values: ['  Renewal ', 'renewal', 'Upsell'] })).toEqual({
      ok: true,
      value: { target: { kind: 'picklist', id: 'opportunityType' }, values: ['Renewal', 'Upsell'], meaning: null, group: null },
    })
  })

  it('reads a meaning by its id or its label, and refuses one only the platform sets', () => {
    expect(readCrmPicklistValuesSetup({ list: 'leadStatus', values: ['Contacted'], meaning: 'Working' })).toMatchObject({
      ok: true,
      value: { meaning: 'working' },
    })
    const missing = readCrmPicklistValuesSetup({ list: 'leadStatus', values: ['Contacted'] })
    expect(missing).toEqual({ ok: false, problems: ['Each lead status value means one of: New, Nurturing, Working, Unqualified. Say which.'] })
    expect(readCrmPicklistValuesSetup({ list: 'leadStatus', values: ['Won'], meaning: 'qualified' }).ok).toBe(false)
  })

  it('reads a lead source group by id or label, and refuses one the list does not have', () => {
    expect(readCrmPicklistValuesSetup({ list: 'leadSource', values: ['Podcast'], group: 'Outbound' })).toMatchObject({
      ok: true,
      value: { group: 'outbound' },
    })
    expect(readCrmPicklistValuesSetup({ list: 'leadSource', values: ['Podcast'], group: 'sideways' }).ok).toBe(false)
  })

  it('names a custom Choice field by object and field', () => {
    expect(checkCrmPicklistValuesSetup({ list: 'custom', object: 'deal', field: 'Tier', values: ['Gold'] })).toEqual({
      ok: true,
      facts: { list: 'custom', object: 'deal', field: 'Tier', values: ['Gold'] },
    })
    expect(checkCrmPicklistValuesSetup({ list: 'custom', object: 'opportunity', values: ['Gold'] }).ok).toBe(false)
  })

  it('refuses an unknown list, no values, and more than one ask adds', () => {
    expect(checkCrmPicklistValuesSetup({ list: 'dealStage', values: ['x'] }).ok).toBe(false)
    expect(checkCrmPicklistValuesSetup({ list: 'rating', values: [] }).ok).toBe(false)
    const many = Array.from({ length: CRM_PICKLIST_VALUES_SETUP_MAX + 1 }, (_, i) => `V${i}`)
    expect(checkCrmPicklistValuesSetup({ list: 'rating', values: many }).ok).toBe(false)
  })
})

describe('planning a standard picklist', () => {
  it('appends what is missing and reports what was there, without removing or reordering', () => {
    const before = effectiveCrmPicklist('rating', null)
    const plan = planCrmPicklistValues(definitionOf('rating'), before, { values: ['Lukewarm', 'HOT'], meaning: null, group: null })
    expect(plan).toMatchObject({ ok: true, added: ['Lukewarm'], existing: ['Hot'], inactive: [] })
    if (plan.ok) {
      expect(plan.picklist.values.map((one) => one.label)).toEqual(['Hot', 'Warm', 'Cold', 'Lukewarm'])
      expect(plan.picklist.defaultValueId).toBe(before.defaultValueId)
    }
  })

  it('finds Nurturing already a standard lead status', () => {
    const plan = planCrmPicklistValues(definitionOf('leadStatus'), effectiveCrmPicklist('leadStatus', null), {
      values: ['nurturing'],
      meaning: 'nurturing',
      group: null,
    })
    expect(plan).toMatchObject({ ok: true, added: [], existing: ['Nurturing'] })
  })
})

describe('planning a custom Choice field', () => {
  const field = (overrides: Partial<CrmFieldDefinitionDoc>): CrmFieldDefinitionDoc =>
    ({ $id: 'f1', key: 'tier', label: 'Tier', type: 'select', options: ['Gold'], object: 'deal', order: 0, visibleTo: ['org'], hostId: 'h1', ...overrides }) as CrmFieldDefinitionDoc
  const target = { kind: 'custom', object: 'deal', field: 'TIER' } as const

  it('adds the missing choices to the active field of that name or key', () => {
    expect(planCrmCustomChoiceValues({ target, values: ['gold', 'Silver'] }, [field({})])).toEqual({
      ok: true,
      id: 'f1',
      label: 'Tier',
      options: ['Gold', 'Silver'],
      added: ['Silver'],
      existing: ['Gold'],
      inactive: [],
    })
  })

  it('refuses a retired, absent or non-Choice field, and one past the drawer’s ceiling', () => {
    expect(planCrmCustomChoiceValues({ target, values: ['x'] }, [field({ retiredAt: 1 })])).toMatchObject({ ok: false, status: 404 })
    expect(planCrmCustomChoiceValues({ target, values: ['x'] }, [field({ type: 'number' })])).toMatchObject({ ok: false, status: 409 })
    const full = Array.from({ length: CRM_FIELD_OPTIONS_MAX }, (_, i) => `O${i}`)
    expect(planCrmCustomChoiceValues({ target, values: ['x'] }, [field({ options: full })])).toMatchObject({ ok: false, status: 409 })
  })
})
