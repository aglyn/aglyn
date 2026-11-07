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
  type DatasetRailEntry,
  datasetCreatedLabel,
  datasetRecordTitle,
  datasetRailSecondary,
  datasetSourceLabel,
  groupDatasetsBySharing,
  sortDatasetsByName,
} from './dataset-rail'

/** The Data page's rail of datasets (AGL-4047): what each tab says, and how they group. */

const MODEL = {
  order: ['name', 'description', 'duration', 'category'],
  fields: {
    name: { name: 'Name', type: 'text' },
    description: { name: 'Description', type: 'text' },
    duration: { name: 'Duration', type: 'text' },
    category: { name: 'Category', type: 'text' },
  },
} as const
const NAMES = { bakery: 'Bakery', downtown: 'Downtown' }
const entry = (id: string, displayName: string, visibleTo: string[], extra: object = {}): DatasetRailEntry =>
  ({ $id: id, displayName, model: MODEL, visibleTo, ...extra }) as unknown as DatasetRailEntry

describe('the second line', () => {
  it('says who a dataset is shared with and how many fields it has, ungrouped', () => {
    expect(datasetRailSecondary(entry('a', 'Services', ['host:bakery']), { hostNames: NAMES, grouped: false })).toBe(
      'Bakery only · 4 fields',
    )
    expect(datasetRailSecondary(entry('a', 'Services', ['org']), { hostNames: NAMES, grouped: false })).toBe(
      'All sites · 4 fields',
    )
    expect(
      datasetRailSecondary(entry('a', 'Services', ['host:bakery', 'host:downtown']), { hostNames: NAMES, grouped: false }),
    ).toBe('2 sites · 4 fields')
    // One field is one field.
    expect(
      datasetRailSecondary({ $id: 'b', displayName: 'Team', fields: ['name'], visibleTo: ['org'] } as DatasetRailEntry, {
        hostNames: NAMES,
        grouped: false,
      }),
    ).toBe('All sites · 1 field')
  })

  it('names the first three fields instead, in a group whose heading already says who', () => {
    expect(datasetRailSecondary(entry('a', 'Services', ['host:bakery']), { hostNames: NAMES, grouped: true })).toBe(
      '4 fields · Name, Description, Duration',
    )
  })
})

describe('the groups', () => {
  it('groups by sharing, headed with how many each holds, groups and names in order', () => {
    const groups = groupDatasetsBySharing(
      [
        entry('d1', 'Menu', ['host:downtown']),
        entry('b2', 'Services', ['host:bakery']),
        entry('b1', 'Allergens', ['host:bakery']),
        entry('w1', 'Products', ['org']),
      ],
      NAMES,
    )
    expect(groups.map((group) => [group.label, group.datasets.map((one) => one.$id)])).toEqual([
      ['All sites (1)', ['w1']],
      ['Bakery only (2)', ['b1', 'b2']],
      ['Downtown only (1)', ['d1']],
    ])
  })
})

describe('the order', () => {
  it('keeps two of one name in a stable order', () => {
    expect(
      sortDatasetsByName([entry('z', 'services', ['org']), entry('b', 'Allergens', ['org']), entry('a', 'Services', ['org'])]).map(
        (one) => one.$id,
      ),
    ).toEqual(['b', 'a', 'z'])
  })
})

describe('the facts', () => {
  it('says where a dataset came from', () => {
    expect(datasetSourceLabel(entry('a', 'x', ['org']))).toBe('--')
    expect(datasetSourceLabel(entry('a', 'x', ['org'], { source: { listingId: 'l1', version: 2 } }))).toBe(
      'Marketplace, version 2',
    )
    expect(datasetSourceLabel(entry('a', 'x', ['org'], { source: { listingId: 'l1' } }))).toBe('Marketplace')
  })

  it('dates a dataset when it was stamped, and says so when it was not', () => {
    expect(datasetCreatedLabel(entry('a', 'x', ['org'], { createdAt: { seconds: Date.UTC(2026, 9, 2, 12) / 1000 } }), 'en-US')).toBe(
      'Oct 2, 2026',
    )
    expect(datasetCreatedLabel(entry('a', 'x', ['org']))).toBe('--')
  })
})

describe('a record’s own page heading', () => {
  it('is the first field that shows a value, passing over a reference', () => {
    const model = {
      order: ['owner', 'name', 'duration'],
      fields: {
        owner: { name: 'Owner', type: 'reference', reference: { datasetId: 'people' } },
        name: { name: 'Name', type: 'text' },
        duration: { name: 'Duration', type: 'text' },
      },
    } as never
    expect(datasetRecordTitle(model, { owner: 'p1', name: 'Custom cakes', duration: '45 min' })).toBe('Custom cakes')
    expect(datasetRecordTitle(model, { owner: 'p1', name: '  ', duration: '45 min' })).toBe('45 min')
    expect(datasetRecordTitle(model, {})).toBe('Untitled record')
  })
})
