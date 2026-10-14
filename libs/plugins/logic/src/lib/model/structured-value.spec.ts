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

import { formatVariableValue } from '@aglyn/aglyn'
import {
  duplicateStructuredKeys,
  parseStructuredValue,
  serializeStructuredValue,
} from './structured-value'

describe('a dictionary or list variable, as rows (AGL-3757)', () => {
  it('reads a stored dictionary into typed rows', () => {
    expect(
      parseStructuredValue(
        '{"name": "Pro", "annual": 39, "featured": true}',
        'dictionary',
      ),
    ).toEqual({
      rows: [
        { key: 'name', kind: 'text', value: 'Pro' },
        { key: 'annual', kind: 'number', value: '39' },
        { key: 'featured', kind: 'boolean', value: 'true' },
      ],
      unreadable: false,
    })
  })

  it('writes the rows back as the same JSON, numbers as numbers', () => {
    const stored = '{"name":"Pro","annual":39,"featured":true}'
    const { rows } = parseStructuredValue(stored, 'dictionary')
    expect(serializeStructuredValue(rows, 'dictionary')).toBe(stored)
  })

  it('round-trips a list, and a bare {{name}} still reads comma-joined', () => {
    const stored = '["a",2,false]'
    const { rows } = parseStructuredValue(stored, 'collection')
    const written = serializeStructuredValue(rows, 'collection')
    expect(written).toBe(stored)
    expect(
      formatVariableValue({ name: 'x', type: 'collection', value: written }),
    ).toBe('a, 2, false')
  })

  it('carries a nested value through untouched', () => {
    const stored = '{"tiers":[1,2],"label":"x"}'
    const { rows } = parseStructuredValue(stored, 'dictionary')
    expect(rows[0]).toMatchObject({ key: 'tiers', kind: 'kept' })
    expect(serializeStructuredValue(rows, 'dictionary')).toBe(stored)
  })

  it('says so when a stored value is not the expected shape', () => {
    expect(parseStructuredValue('{"a": 1,}', 'dictionary').unreadable).toBe(true)
    expect(parseStructuredValue('["a"]', 'dictionary').unreadable).toBe(true)
    expect(parseStructuredValue('{"a": 1}', 'collection').unreadable).toBe(true)
    expect(parseStructuredValue('', 'collection')).toEqual({
      rows: [],
      unreadable: false,
    })
  })

  it('drops keyless rows, stores a non-number as nothing, flags repeats', () => {
    const rows = [
      { key: '', kind: 'text' as const, value: 'orphan' },
      { key: 'price', kind: 'number' as const, value: '-' },
      { key: 'a', kind: 'text' as const, value: '1' },
      { key: 'a ', kind: 'text' as const, value: '2' },
    ]
    expect(serializeStructuredValue(rows, 'dictionary')).toBe(
      '{"price":null,"a":"2"}',
    )
    expect([...duplicateStructuredKeys(rows)]).toEqual(['a'])
  })
})
