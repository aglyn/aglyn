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
 * A CURRENCY custom field (AGL-3756) on every CRM surface that reads a
 * field's type: the list column, the contacts filter, import and export,
 * the setup model an AI build writes through, and the op's schema. Each is
 * the same rule — a value is a whole number of the field's currency's minor
 * unit, typed and read in major units.
 */

import { type ContactFieldDefinition, crmContactCustomColumn } from '@aglyn/aglyn'
import type { GridColDef } from '@mui/x-data-grid'
import { CONTACT_FACET_KEYS_PATH, contactCustomFilterFields, contactQueryClause } from '../constants/contact-filters'
import { planCrmFieldSetup, readCrmFieldSetup } from '../model/crm-setup-content'
import { crmFieldAiCapability, crmFieldSetupContentFromArgs } from '../server/crm-setup-ai-capabilities'
import { customTransferValue, customWriteValues } from '../transfer/common'
import { crmCustomTransferFields } from '../transfer/fields'
import { contactCustomAmountReaders, customFieldColumns, formatContactCustomValue } from './contact-custom-columns'
import { currencyInputText } from './crm-custom-field-control'

// The transfer helpers are pure; their module's server imports are not reached.
jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-data-admin/server/org-containers', () => ({ __esModule: true, listOrgContainers: async () => [] }))

const definition = (
  overrides: Partial<ContactFieldDefinition> & Pick<ContactFieldDefinition, 'key' | 'type'>,
): ContactFieldDefinition => ({
  label: overrides.key,
  order: 0,
  visibleTo: ['org'],
  hostId: 'host-1',
  ...overrides,
})

const budget = definition({ key: 'budget', type: 'currency', currency: 'eur' })

describe('a currency field on a list', () => {
  it('reads as money in its currency, and nothing when empty', () => {
    expect(formatContactCustomValue(budget, 125050)).toBe(
      new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(1250.5),
    )
    expect(formatContactCustomValue(budget, null)).toBe('')
  })

  it('hands the page sort the stored amount, not the formatted text', () => {
    const [column] = customFieldColumns([budget]) as [GridColDef]
    const getter = column.valueGetter as unknown as (value: unknown, row: unknown) => unknown
    expect(column.field).toBe(crmContactCustomColumn('budget'))
    expect(getter(undefined, { custom: { budget: 900 } })).toBe(900)
    expect(getter(undefined, { custom: {} })).toBeNull()
  })

  it('shows a stored amount in its box in major units', () => {
    expect(currencyInputText(125050, 'usd')).toBe('1250.50')
    expect(currencyInputText(1250, 'jpy')).toBe('1250')
    expect(currencyInputText(null, 'usd')).toBe('')
  })
})

describe('a currency field in the contacts filter', () => {
  const amounts = contactCustomAmountReaders([budget, definition({ key: 'n', type: 'number' })])

  it('offers equality and presence, as a number field does', () => {
    expect(contactCustomFilterFields([budget])[0]).toMatchObject({ kind: 'number', operators: ['=', 'isNotEmpty'] })
    expect(Object.keys(amounts)).toEqual([crmContactCustomColumn('budget')])
    expect(amounts[crmContactCustomColumn('budget')]?.('€1,250.50')).toBe(125050)
  })

  it('asks the facet key of the minor units the typed amount is', () => {
    const asked = contactQueryClause(
      { field: crmContactCustomColumn('budget'), op: '=', value: '1,250.50' },
      { groupId: null, foldsScope: true, amounts },
    )
    expect(asked).toEqual({ field: CONTACT_FACET_KEYS_PATH, op: 'contains', value: '*:custom.budget=125050' })
  })

  it('refuses an amount it cannot read rather than asking for nothing', () => {
    expect(
      contactQueryClause(
        { field: crmContactCustomColumn('budget'), op: '=', value: 'lots' },
        { groupId: null, foldsScope: true, amounts },
      ),
    ).toEqual({ refused: 'no value yet' })
  })
})

describe('a currency field in a file', () => {
  it('exports major units and imports them back as minor units', () => {
    expect(customTransferValue(budget, 125050)).toBe(1250.5)
    expect(customWriteValues({ 'custom:budget': 1250.5 }, [budget], 'contact')).toEqual({ values: { budget: 125050 } })
    expect(customWriteValues({ 'custom:budget': '' }, [budget], 'contact')).toEqual({ values: { budget: null } })
  })

  it('is read from a cell as a number', () => {
    expect(crmCustomTransferFields([budget], 'contact')[0]).toMatchObject({ key: 'budget', type: 'number' })
  })
})

describe('a currency field an AI build sets up', () => {
  const context = { hostId: 'host-1', now: new Date(0), visibleTo: ['org'] }

  it('stores the currency asked for, USD when none, and refuses a code that is not one', () => {
    const read = readCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'currency', currency: 'EUR' })
    expect(read).toMatchObject({ ok: true, value: { type: 'currency', currency: 'eur' } })
    const plan = read.ok ? planCrmFieldSetup(read.value, [], context) : null
    expect(plan).toMatchObject({ kind: 'create', document: { type: 'currency', currency: 'eur' } })
    expect(readCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'currency' })).toMatchObject({
      ok: true,
      value: { currency: 'usd' },
    })
    expect(readCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'currency', currency: 'XX1' }).ok).toBe(false)
    expect(readCrmFieldSetup({ object: 'deal', label: 'Seats', type: 'number', currency: 'EUR' })).toMatchObject({
      ok: true,
      value: { currency: null },
    })
  })

  it('offers currency in the op’s schema and passes it to the writer', () => {
    const properties = crmFieldAiCapability.argsSchema.properties as Record<string, { enum?: readonly string[] }>
    expect(properties['type']?.enum).toContain('currency')
    expect(properties['currency']).toBeDefined()
    expect(crmFieldSetupContentFromArgs({ object: 'deal', label: 'Budget', type: 'currency', currency: 'EUR' })).toEqual({
      object: 'deal',
      label: 'Budget',
      type: 'currency',
      currency: 'EUR',
    })
  })
})
