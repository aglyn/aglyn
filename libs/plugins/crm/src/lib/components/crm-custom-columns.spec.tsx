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
 * The custom-field columns over EVERY list (AGL-2661).
 *
 * One column set serves the contacts list, the companies list and the
 * deals table, reading each row's own `custom` map — so a company row
 * and a deal row have to read exactly as a contact row does, a retired
 * definition has to draw no column anywhere, and a link has to be an
 * anchor on every list.
 */

import type { ContactFieldDefinition, CrmCompany, CrmDeal } from '@aglyn/aglyn'
import { crmContactCustomColumn } from '@aglyn/aglyn'
import { customFieldColumns, formatContactCustomValue } from './contact-custom-columns'

const definition = (
  overrides: Partial<ContactFieldDefinition> & Pick<ContactFieldDefinition, 'key' | 'type'>,
): ContactFieldDefinition => ({
  label: overrides.key,
  order: 0,
  visibleTo: ['org'],
  hostId: 'host-1',
  ...overrides,
})

describe('customFieldColumns over companies and deals (AGL-2661)', () => {
  const columns = customFieldColumns([
    definition({ key: 'region', type: 'select', options: ['West'], object: 'company' }),
    definition({ key: 'site', type: 'url', object: 'company' }),
    definition({ key: 'renewal', type: 'date', object: 'deal' }),
    definition({ key: 'gone', type: 'text', object: 'deal', retiredAt: 1 }),
  ])
  const column = (key: string) =>
    columns.find((entry) => entry.field === crmContactCustomColumn(key))!

  it('reads a company row and a deal row off their own custom map', () => {
    const company: Partial<CrmCompany> & { $id: string } = {
      $id: 'c1',
      name: 'Acme',
      custom: { region: 'West', site: 'https://acme.com' },
    }
    const deal: Partial<CrmDeal> & { $id: string } = {
      $id: 'd1',
      title: 'Roast',
      custom: { renewal: '2026-03-01T00:00:00.000Z' },
    }
    expect((column('region').valueGetter as any)(undefined, company)).toBe('West')
    expect((column('renewal').valueGetter as any)(undefined, deal)).toBe(
      new Date('2026-03-01T00:00:00.000Z').toLocaleDateString(),
    )
    // A row with no map reads as nothing, never as an error.
    expect((column('region').valueGetter as any)(undefined, { $id: 'x' })).toBe('')
  })

  it('draws no column for a retired definition, and an anchor for a link', () => {
    expect(columns.map((entry) => entry.field)).toEqual([
      crmContactCustomColumn('region'),
      crmContactCustomColumn('site'),
      crmContactCustomColumn('renewal'),
    ])
    const cell = (column('site').renderCell as any)({
      row: { custom: { site: 'https://acme.com' } },
    })
    expect(JSON.stringify(cell)).toContain('"href":"https://acme.com"')
    expect(column('site').sortable).toBe(false)
    expect(column('site').filterable).toBe(false)
  })

  it('formats every type the way the contacts list does', () => {
    expect(formatContactCustomValue({ type: 'checkbox' }, true)).toBe('Yes')
    expect(formatContactCustomValue({ type: 'number' }, 1200)).toBe((1200).toLocaleString())
    expect(formatContactCustomValue({ type: 'text' }, null)).toBe('')
  })
})
