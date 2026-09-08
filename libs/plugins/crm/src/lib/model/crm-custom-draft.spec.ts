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
 * The custom-field draft every editing surface shares (AGL-2661).
 *
 * Three contracts: only what CHANGED is written, and as dotted paths so
 * the stored map is merged; a create stores values and never nulls; and a
 * required field is demanded on a create, but on an edit only when the
 * reader cleared it.
 */

import {
  crmCustomDraftChanges,
  crmCustomDraftDocument,
  crmCustomDraftMissingRequired,
  crmCustomDraftValue,
  crmCustomDraftWrites,
} from './crm-custom-draft'

const stored = { tier: 'gold', seats: 4, vip: true, cleared: null }

describe('the custom-field draft (AGL-2661)', () => {
  it('shows the draft where touched and the stored value elsewhere', () => {
    expect(crmCustomDraftValue(stored, {}, 'tier')).toBe('gold')
    expect(crmCustomDraftValue(stored, { tier: 'silver' }, 'tier')).toBe('silver')
    expect(crmCustomDraftValue(stored, { tier: null }, 'tier')).toBeNull()
    expect(crmCustomDraftValue(stored, {}, 'absent')).toBeUndefined()
  })

  it('writes only what changed, as dotted paths, clearing with null', () => {
    const draft = { tier: 'gold', seats: 5, vip: null, cleared: null, region: 'west' }
    expect(crmCustomDraftChanges(stored, draft)).toEqual([
      ['seats', 5],
      ['vip', null],
      ['region', 'west'],
    ])
    expect(crmCustomDraftWrites(stored, draft)).toEqual({
      'custom.seats': 5,
      'custom.vip': null,
      'custom.region': 'west',
    })
    expect(crmCustomDraftWrites(stored, {})).toEqual({})
  })

  it('stores a create map without its nulls, or nothing at all', () => {
    expect(crmCustomDraftDocument({ tier: 'gold', seats: null, vip: false })).toEqual({
      tier: 'gold',
      vip: false,
    })
    expect(crmCustomDraftDocument({ seats: null })).toBeUndefined()
    expect(crmCustomDraftDocument({})).toBeUndefined()
  })

  it('demands a required field on a create, and on an edit only when cleared', () => {
    const definitions = [
      { key: 'tier', label: 'Tier', required: true },
      { key: 'seats', label: 'Seats', required: true },
      { key: 'notes', label: 'Notes', required: false },
    ]
    expect(crmCustomDraftMissingRequired(definitions, {}, {}, 'create')).toEqual([
      'Tier',
      'Seats',
    ])
    expect(crmCustomDraftMissingRequired(definitions, {}, { tier: 'gold' }, 'create')).toEqual([
      'Seats',
    ])
    // Stored without seats: an edit that does not touch seats is not refused.
    expect(crmCustomDraftMissingRequired(definitions, { tier: 'gold' }, {}, 'edit')).toEqual([])
    expect(
      crmCustomDraftMissingRequired(definitions, { tier: 'gold' }, { tier: null }, 'edit'),
    ).toEqual(['Tier'])
    expect(
      crmCustomDraftMissingRequired(definitions, { tier: 'gold' }, { tier: '' }, 'edit'),
    ).toEqual(['Tier'])
  })
})
