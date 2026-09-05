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
 * Custom contact field values (AGL-2601): one coercion rule for every door.
 *
 * A form posts every field as text, an API body carries typed JSON, and the
 * console writes whatever its control holds — and all three have to land the
 * same stored shape under one definition, or a number filter finds the API's
 * numbers and not the form's. The cases here pin the rule per type, the two
 * different meanings of "nothing" (`undefined` drops, `null` clears), and the
 * carry-over that stops a publish from unmapping every field.
 */

import {
  activeContactFieldDefinitions,
  carryContactFieldMappings,
  coerceContactCustomValue,
  collectMappedContactCustom,
  CONTACT_FIELDS_MAX_PER_ORG,
  readContactCustomInput,
  sortContactFieldDefinitions,
} from './contact-custom-fields'
import type { ContactFieldDefinition } from './crm'
import type { FormFieldDecl } from './forms'

const definition = (
  overrides: Partial<ContactFieldDefinition> & Pick<ContactFieldDefinition, 'key' | 'type'>,
): ContactFieldDefinition => ({
  label: overrides.key,
  order: 0,
  visibleTo: ['org'],
  hostId: 'host-1',
  ...overrides,
})

const DEFINITIONS: ContactFieldDefinition[] = [
  definition({ key: 'annual_revenue', type: 'number', order: 1 }),
  definition({ key: 'tier', type: 'select', options: ['Gold', 'Silver'], order: 0 }),
  definition({ key: 'vip', type: 'checkbox', order: 2 }),
  definition({ key: 'renewal', type: 'date', order: 3 }),
  definition({ key: 'site', type: 'url', order: 4 }),
  definition({ key: 'nickname', type: 'text', order: 5 }),
  definition({ key: 'legacy', type: 'text', order: 6, retiredAt: 1 }),
]

describe('coerceContactCustomValue', () => {
  it('stores a number from a number or a numeric string, and drops anything else', () => {
    const number = definition({ key: 'n', type: 'number' })
    expect(coerceContactCustomValue(number, 42)).toBe(42)
    expect(coerceContactCustomValue(number, ' 1200.5 ')).toBe(1200.5)
    expect(coerceContactCustomValue(number, 'twelve')).toBeUndefined()
    expect(coerceContactCustomValue(number, '')).toBeUndefined()
    expect(coerceContactCustomValue(number, Number.NaN)).toBeUndefined()
    expect(coerceContactCustomValue(number, true)).toBeUndefined()
  })

  it('reads a checkbox the way a browser posts one', () => {
    const checkbox = definition({ key: 'c', type: 'checkbox' })
    expect(coerceContactCustomValue(checkbox, 'on')).toBe(true)
    expect(coerceContactCustomValue(checkbox, 'true')).toBe(true)
    expect(coerceContactCustomValue(checkbox, false)).toBe(false)
    expect(coerceContactCustomValue(checkbox, 'off')).toBe(false)
    expect(coerceContactCustomValue(checkbox, 'maybe')).toBeUndefined()
  })

  it('stores a date as ISO 8601 whatever spelled it', () => {
    const date = definition({ key: 'd', type: 'date' })
    expect(coerceContactCustomValue(date, '2026-09-05')).toBe('2026-09-05T00:00:00.000Z')
    expect(coerceContactCustomValue(date, Date.UTC(2026, 8, 5))).toBe(
      '2026-09-05T00:00:00.000Z',
    )
    expect(coerceContactCustomValue(date, 'next tuesday')).toBeUndefined()
  })

  it('keeps only a declared choice', () => {
    const select = definition({ key: 's', type: 'select', options: ['Gold', 'Silver'] })
    expect(coerceContactCustomValue(select, ' Gold ')).toBe('Gold')
    expect(coerceContactCustomValue(select, 'Bronze')).toBeUndefined()
    expect(coerceContactCustomValue(select, 'gold')).toBeUndefined()
    expect(
      coerceContactCustomValue(definition({ key: 's', type: 'select' }), 'Gold'),
    ).toBeUndefined()
  })

  it('keeps a link only when it is an http(s) URL', () => {
    const url = definition({ key: 'u', type: 'url' })
    expect(coerceContactCustomValue(url, ' https://acme.example/about ')).toBe(
      'https://acme.example/about',
    )
    expect(coerceContactCustomValue(url, 'acme.example')).toBeUndefined()
    expect(coerceContactCustomValue(url, 'javascript:alert(1)')).toBeUndefined()
  })

  it('trims text and treats blank as nothing, not as an empty string', () => {
    const text = definition({ key: 't', type: 'text' })
    expect(coerceContactCustomValue(text, '  Robin  ')).toBe('Robin')
    expect(coerceContactCustomValue(text, '   ')).toBeUndefined()
    expect(coerceContactCustomValue(text, null)).toBeUndefined()
    expect(coerceContactCustomValue(text, 'x'.repeat(3000))).toHaveLength(2000)
  })
})

describe('collectMappedContactCustom', () => {
  const decls: FormFieldDecl[] = [
    { fieldName: 'email', fieldType: 'email' },
    { fieldName: 'revenue', fieldType: 'text', contactFieldKey: 'annual_revenue' },
    { fieldName: 'tier', fieldType: 'select', contactFieldKey: 'tier' },
    { fieldName: 'vip', fieldType: 'checkbox', contactFieldKey: 'vip' },
    { fieldName: 'old', fieldType: 'text', contactFieldKey: 'legacy' },
    { fieldName: 'ghost', fieldType: 'text', contactFieldKey: 'no_such_field' },
  ]

  it('writes one coerced entry per mapped field that carried a value', () => {
    expect(
      collectMappedContactCustom({
        fields: { email: 'a@b.co', revenue: '1200', tier: 'Gold', vip: 'on', old: 'x' },
        decls,
        definitions: DEFINITIONS,
      }),
    ).toEqual({ annual_revenue: 1200, tier: 'Gold', vip: true })
  })

  it('drops a blank, an off-list choice and a field with no mapping — never writing null', () => {
    const custom = collectMappedContactCustom({
      fields: { email: 'a@b.co', revenue: '', tier: 'Bronze', vip: 'off' },
      decls,
      definitions: DEFINITIONS,
    })
    expect(custom).toEqual({ vip: false })
    expect(Object.values(custom)).not.toContain(null)
  })

  it('writes nothing under a retired or an unknown definition', () => {
    const custom = collectMappedContactCustom({
      fields: { old: 'still typed', ghost: 'typed too' },
      decls,
      definitions: DEFINITIONS,
    })
    expect(custom).toEqual({})
  })

  it('lets the first declared field win when two map onto one key', () => {
    expect(
      collectMappedContactCustom({
        fields: { first: 'Robin', second: 'Sam' },
        decls: [
          { fieldName: 'first', fieldType: 'text', contactFieldKey: 'nickname' },
          { fieldName: 'second', fieldType: 'text', contactFieldKey: 'nickname' },
        ],
        definitions: DEFINITIONS,
      }),
    ).toEqual({ nickname: 'Robin' })
  })
})

describe('carryContactFieldMappings', () => {
  it('carries a mapping across a publish by field name, and only that', () => {
    const previous: FormFieldDecl[] = [
      { fieldName: 'revenue', fieldType: 'text', label: 'Old label', contactFieldKey: 'annual_revenue' },
      { fieldName: 'removed', fieldType: 'text', contactFieldKey: 'tier' },
    ]
    const next: FormFieldDecl[] = [
      { fieldName: 'revenue', fieldType: 'text', label: 'New label' },
      { fieldName: 'added', fieldType: 'text' },
    ]
    expect(carryContactFieldMappings(previous, next)).toEqual([
      { fieldName: 'revenue', fieldType: 'text', label: 'New label', contactFieldKey: 'annual_revenue' },
      { fieldName: 'added', fieldType: 'text' },
    ])
  })

  it('is the identity when nothing was mapped before', () => {
    const next: FormFieldDecl[] = [{ fieldName: 'a', fieldType: 'text' }]
    expect(carryContactFieldMappings(undefined, next)).toEqual(next)
    expect(carryContactFieldMappings([], next)).toEqual(next)
  })
})

describe('readContactCustomInput — the API door', () => {
  it('coerces every known key and clears on an explicit null', () => {
    expect(
      readContactCustomInput(
        { annual_revenue: '99', tier: 'Silver', vip: null, renewal: '2026-01-02' },
        DEFINITIONS,
      ),
    ).toEqual({
      values: {
        annual_revenue: 99,
        tier: 'Silver',
        vip: null,
        renewal: '2026-01-02T00:00:00.000Z',
      },
    })
  })

  it('names every unknown key rather than dropping it', () => {
    const result = readContactCustomInput({ nickname: 'R', typo_key: 1, other: 2 }, DEFINITIONS)
    expect(result).toEqual({
      errors: {
        'custom.typo_key': 'No such contact field',
        'custom.other': 'No such contact field',
      },
    })
  })

  it('refuses a retired field and a value the type cannot hold, saying which', () => {
    const result = readContactCustomInput(
      { legacy: 'x', annual_revenue: 'lots', tier: 'Bronze' },
      DEFINITIONS,
    )
    expect('errors' in result && result.errors['custom.legacy']).toContain('Retired')
    expect('errors' in result && result.errors['custom.annual_revenue']).toBe('Must be a number')
    expect('errors' in result && result.errors['custom.tier']).toBe('Must be one of: Gold, Silver')
  })

  it('refuses a body that is not an object', () => {
    expect(readContactCustomInput(['a'], DEFINITIONS)).toEqual({
      errors: { custom: expect.stringContaining('object') },
    })
    expect(readContactCustomInput('x', DEFINITIONS)).toHaveProperty('errors')
  })
})

describe('ordering and the read bound', () => {
  it('sorts by order then key, and excludes retired ones from the active set', () => {
    expect(sortContactFieldDefinitions(DEFINITIONS).map((d) => d.key)).toEqual([
      'tier',
      'annual_revenue',
      'vip',
      'renewal',
      'site',
      'nickname',
      'legacy',
    ])
    expect(activeContactFieldDefinitions(DEFINITIONS).map((d) => d.key)).not.toContain('legacy')
    expect(
      sortContactFieldDefinitions([
        { key: 'b', order: 1 },
        { key: 'a', order: 1 },
      ]).map((d) => d.key),
    ).toEqual(['a', 'b'])
  })

  it('bounds the whole-collection read at a number a profile form can carry', () => {
    expect(CONTACT_FIELDS_MAX_PER_ORG).toBeGreaterThanOrEqual(50)
    expect(CONTACT_FIELDS_MAX_PER_ORG).toBeLessThanOrEqual(500)
  })
})
