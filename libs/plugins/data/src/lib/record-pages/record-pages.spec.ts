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
 * Record pages' model (AGL-3475): which request path is which record's page,
 * what a page address is, what a base may be, and how an address is written
 * once and then left where it is.
 */

import { datasetFilterValues, type DatasetModel } from '../model/dataset-models'
import {
  RECORD_PAGE_ADDRESS_FIELD,
  RECORD_PAGE_ADDRESS_FIELD_TYPE,
  RECORD_PAGE_ADDRESS_MAX,
  fillRecordAddresses,
  isRecordAddress,
  matchRecordPagePath,
  normalizeRecordAddress,
  normalizeRecordPageBase,
  parseRecordPageBinding,
  recordPageBaseRefusal,
  recordPageHead,
  recordPagePath,
  referencedRecordIds,
  uniqueRecordAddresses,
  withRecordPageUrls,
} from './record-pages'

const SERVICES: DatasetModel = {
  order: ['name', 'slug', 'summary', 'photo', 'seo_title'],
  fields: {
    name: { name: 'Name', type: 'text' },
    slug: {
      name: 'Page address',
      type: 'text',
      customType: RECORD_PAGE_ADDRESS_FIELD_TYPE,
      slugFrom: 'name',
    },
    summary: { name: 'Summary', type: 'text' },
    photo: { name: 'Photo', type: 'text' },
    seo_title: { name: 'Search title', type: 'text' },
  },
}

describe('a page address', () => {
  it('is the URL segment of any text, accents folded', () => {
    expect(normalizeRecordAddress('Kitchen Remodeling')).toBe('kitchen-remodeling')
    expect(normalizeRecordAddress('  Café & Bar!  ')).toBe('cafe-bar')
    expect(normalizeRecordAddress('kitchen-remodeling')).toBe('kitchen-remodeling')
    expect(normalizeRecordAddress(2026)).toBe('2026')
    expect(normalizeRecordAddress('!!!')).toBe('')
    expect(normalizeRecordAddress(null)).toBe('')
    expect(normalizeRecordAddress({ name: 'x' })).toBe('')
  })

  it('never runs past the length the indexed lookup holds whole', () => {
    const long = normalizeRecordAddress(`${'word '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(RECORD_PAGE_ADDRESS_MAX)
    expect(long.endsWith('-')).toBe(false)
    expect(isRecordAddress(long)).toBe(true)
  })

  it('is stored as exactly the key its filter entry holds, so the lookup finds it', () => {
    const values = { name: 'Kitchen Remodeling', slug: 'kitchen-remodeling' }
    expect(datasetFilterValues(SERVICES, values)['slug']).toBe('kitchen-remodeling')
  })

  it('is refused by its field type when nothing addressable is left', () => {
    expect(RECORD_PAGE_ADDRESS_FIELD.validate?.('kitchen-remodeling')).toBeNull()
    expect(RECORD_PAGE_ADDRESS_FIELD.validate?.('Kitchen Remodeling')).toMatch(/lowercase/)
    expect(RECORD_PAGE_ADDRESS_FIELD.baseType).toBe('text')
  })
})

describe('filling addresses', () => {
  it('fills an empty address from its source on the first write', () => {
    expect(fillRecordAddresses(SERVICES, { name: 'Roof Repair' })).toEqual({
      name: 'Roof Repair',
      slug: 'roof-repair',
    })
  })

  it('keeps the address a record already has when the record is renamed', () => {
    const renamed = { name: 'Roof Repair & Replacement', slug: 'roof-repair' }
    expect(fillRecordAddresses(SERVICES, renamed)).toBe(renamed)
  })

  it('normalizes an address typed by hand', () => {
    expect(
      fillRecordAddresses(SERVICES, { name: 'Gutters', slug: 'Gutter Guards' }),
    ).toEqual({ name: 'Gutters', slug: 'gutter-guards' })
  })

  it('drops an address with nothing addressable in it rather than storing junk', () => {
    expect(fillRecordAddresses(SERVICES, { name: '!!!', slug: '???' })).toEqual({
      name: '!!!',
    })
  })

  it('leaves values alone when the model has no address field', () => {
    const values = { name: 'Plain' }
    expect(
      fillRecordAddresses(
        { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
        values,
      ),
    ).toBe(values)
  })

  it('gives a batch unique addresses, past the ones already taken', () => {
    const assigned = uniqueRecordAddresses(
      [
        { id: 'a', source: 'Roofing' },
        { id: 'b', source: 'roofing' },
        { id: 'c', source: 'Siding' },
        { id: 'd', source: '…' },
      ],
      ['siding'],
    )
    expect([...assigned]).toEqual([
      ['a', 'roofing'],
      ['b', 'roofing-2'],
      ['c', 'siding-2'],
    ])
  })
})

describe('a base', () => {
  it('is one to four lowercase segments, slashes trimmed', () => {
    expect(normalizeRecordPageBase('/Services/')).toBe('services')
    expect(normalizeRecordPageBase('services//residential')).toBe('services/residential')
    expect(normalizeRecordPageBase('a/b/c/d/e')).toBeNull()
    expect(normalizeRecordPageBase('our services')).toBeNull()
    expect(normalizeRecordPageBase('')).toBeNull()
  })

  it('may not take a reserved address, another route or a collection', () => {
    expect(recordPageBaseRefusal('search')).toMatch(/reserved/)
    expect(recordPageBaseRefusal('api/things')).toMatch(/reserved/)
    expect(recordPageBaseRefusal('author')).toMatch(/reserved/)
    expect(
      recordPageBaseRefusal('products/outlet', { pluginRouteSegments: ['products'] }),
    ).toMatch(/serves pages of its own/)
    expect(recordPageBaseRefusal('blog', { collectionSlugs: ['blog'] })).toMatch(
      /content collection/,
    )
    expect(recordPageBaseRefusal('services', { otherBases: ['services'] })).toMatch(
      /already uses/,
    )
    expect(recordPageBaseRefusal('our services')).toMatch(/path segments/)
  })

  it('may nest inside another template’s base', () => {
    expect(
      recordPageBaseRefusal('services/residential', { otherBases: ['services'] }),
    ).toBeNull()
  })
})

describe('matching a request path', () => {
  const bindings = [
    { base: 'services', name: 'top' },
    { base: 'services/residential', name: 'nested' },
  ]

  it('is the base plus exactly one segment', () => {
    expect(matchRecordPagePath(bindings, '/services/roofing')).toEqual({
      binding: bindings[0],
      address: 'roofing',
    })
    expect(matchRecordPagePath(bindings, '/services/residential/roofing')).toEqual({
      binding: bindings[1],
      address: 'roofing',
    })
    expect(matchRecordPagePath(bindings, '/services')).toBeNull()
    expect(matchRecordPagePath(bindings, '/services/a/b/c')).toBeNull()
    expect(matchRecordPagePath(bindings, '/locations/austin')).toBeNull()
  })

  it('a nested base’s own segment is a record of the base above it', () => {
    expect(matchRecordPagePath(bindings, '/services/residential')).toEqual({
      binding: bindings[0],
      address: 'residential',
    })
  })

  it('finds the record however the address is spelled in the request', () => {
    expect(matchRecordPagePath(bindings, '/Services/Kitchen%20Remodel')?.address).toBe(
      'kitchen-remodel',
    )
    expect(matchRecordPagePath(bindings, '/services/%E0%A4%A')?.address).toBe('e0-a4-a')
  })

  it('builds the path it matches', () => {
    expect(recordPagePath('services/residential', 'roofing')).toBe(
      '/services/residential/roofing',
    )
  })
})

describe('the head of a record page', () => {
  const binding = {
    screenId: 'tmpl',
    datasetId: 'services',
    base: 'services',
    slugField: 'slug',
    seoTitleField: 'seo_title',
    seoDescriptionField: 'summary',
    seoImageField: 'photo',
  }

  it('is named by the first text field and fills its search fields from the record', () => {
    expect(
      recordPageHead(binding, SERVICES, {
        name: 'Roofing',
        slug: 'roofing',
        summary: 'Shingle and metal roofs.',
        photo: 'media:org/roof',
        seo_title: 'Roofing in Austin',
      }),
    ).toEqual({
      name: 'Roofing',
      title: 'Roofing in Austin',
      description: 'Shingle and metal roofs.',
      image: 'media:org/roof',
    })
  })

  it('leaves out what the record has not filled in, so the template’s value stands', () => {
    expect(recordPageHead(binding, SERVICES, { name: 'Siding', slug: 'siding' })).toEqual({
      name: 'Siding',
    })
  })
})

describe('reading a binding back', () => {
  it('keeps what a reader needs and drops blanks', () => {
    expect(
      parseRecordPageBinding('tmpl', {
        datasetId: ' services ',
        base: '/Services/',
        slugField: 'slug',
        seoTitleField: '',
        seoImageField: 'photo',
      }),
    ).toEqual({
      screenId: 'tmpl',
      datasetId: 'services',
      base: 'services',
      slugField: 'slug',
      seoImageField: 'photo',
    })
  })

  it('is null when it names no dataset, base or address field', () => {
    expect(parseRecordPageBinding('tmpl', { base: 'services', slugField: 'slug' })).toBeNull()
    expect(
      parseRecordPageBinding('tmpl', { datasetId: 'd', base: 'not a base', slugField: 's' }),
    ).toBeNull()
    expect(parseRecordPageBinding('', { datasetId: 'd', base: 'b', slugField: 's' })).toBeNull()
  })
})

describe('the records a page’s references point at', () => {
  it('is every id each reference field holds, by the dataset it lives in', () => {
    const wanted = referencedRecordIds(
      { references: { crew: 'people', area: 'areas', broken: 'x/y' } },
      { crew: ['p1', 'p2'], area: 'a1', broken: 'z' },
    )
    expect([...wanted].map(([key, ids]) => [key, [...ids]])).toEqual([
      ['people', ['p1', 'p2']],
      ['areas', ['a1']],
    ])
  })
})

describe('a listing’s link to each record page', () => {
  const binding = { base: 'services', slugField: 'slug' }
  const rows = [
    { $id: 'r1', name: 'Roofing', slug: 'roofing' },
    { $id: 'r2', name: 'No address yet' },
  ]

  it('is {{item.url}} on every row that has an address', () => {
    expect(withRecordPageUrls(rows, binding, SERVICES)).toEqual([
      { $id: 'r1', name: 'Roofing', slug: 'roofing', url: '/services/roofing' },
      { $id: 'r2', name: 'No address yet' },
    ])
  })

  it('is nothing on a site with no record template for the dataset', () => {
    expect(withRecordPageUrls(rows, null, SERVICES)).toBe(rows)
  })

  it('never shadows a field of the dataset’s own called url', () => {
    const model: DatasetModel = {
      ...SERVICES,
      order: [...SERVICES.order, 'url'],
      fields: { ...SERVICES.fields, url: { name: 'Website', type: 'text' } },
    }
    expect(withRecordPageUrls(rows, binding, model)).toBe(rows)
  })
})
