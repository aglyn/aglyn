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
  TRANSFER_ID_FIELD,
  isTransferFieldImportable,
  isTransferFieldWritable,
  isTransferListType,
  isTransferResourceKey,
  parseTransferResourceKey,
  transferFieldProblems,
  transferResourceInstanceKey,
  transferResourceInstanceOf,
  transferResourceProblems,
} from './resource'
import type { TransferField, TransferResourceDescriptor } from './resource'

const people: TransferResourceDescriptor = {
  key: 'people',
  label: 'People',
  scope: 'org',
  kinds: ['records'],
  formats: ['csv', 'json'],
  limits: { maxRows: 5000 },
}

describe('transfer resources', () => {
  it('accepts lowercase keys joined by dots or hyphens', () => {
    expect(isTransferResourceKey('people')).toBe(true)
    expect(isTransferResourceKey('site.pages')).toBe(true)
    expect(isTransferResourceKey('email-list-members')).toBe(true)
    expect(isTransferResourceKey('People')).toBe(false)
    expect(isTransferResourceKey('a b')).toBe(false)
    expect(isTransferResourceKey('-x')).toBe(false)
    expect(isTransferResourceKey(3)).toBe(false)
  })

  it('finds nothing wrong with a well-formed declaration', () => {
    expect(transferResourceProblems(people)).toEqual([])
  })

  it('reports every problem with a malformed declaration', () => {
    const problems = transferResourceProblems({
      key: 'Bad Key',
      label: ' ',
      scope: 'galaxy' as never,
      kinds: [],
      formats: ['xlsx' as never],
      limits: { maxRows: 0, maxBytes: -1 },
    })
    expect(problems).toHaveLength(7)
    expect(problems.join(' ')).toMatch(/not a resource key/)
    expect(problems.join(' ')).toMatch(/no label/)
    expect(problems.join(' ')).toMatch(/scope "galaxy"/)
    expect(problems.join(' ')).toMatch(/no kind/)
    expect(problems.join(' ')).toMatch(/unknown format "xlsx"/)
    expect(problems.join(' ')).toMatch(/row limit/)
    expect(problems.join(' ')).toMatch(/byte limit/)
  })

  it('refuses an instances flag that is not a boolean', () => {
    expect(transferResourceProblems({ ...people, instances: true })).toEqual([])
    expect(transferResourceProblems({ ...people, instances: 'yes' as never })).toEqual([
      'people says "instances" with something other than true or false.',
    ])
  })
})

describe('instance keys', () => {
  it('names one instance of a resource after a colon', () => {
    expect(transferResourceInstanceKey('data.dataset', 'abc_123-X')).toBe('data.dataset:abc_123-X')
    expect(() => transferResourceInstanceKey('data.dataset', 'a/b')).toThrow(/cannot name an instance/)
    expect(() => transferResourceInstanceKey('data.dataset', '')).toThrow(/cannot name an instance/)
  })

  it('reads a key back as the declared resource and its instance', () => {
    expect(parseTransferResourceKey('data.dataset:abc')).toEqual({ key: 'data.dataset', instance: 'abc' })
    expect(parseTransferResourceKey(' people ')).toEqual({ key: 'people', instance: null })
    // A suffix no instance could be stays in the key, which then names nothing.
    expect(parseTransferResourceKey('data.dataset:a b')).toEqual({ key: 'data.dataset:a b', instance: null })
    expect(transferResourceInstanceOf({ resource: 'data.dataset:abc' })).toBe('abc')
    expect(transferResourceInstanceOf({ resource: 'people' })).toBeNull()
  })
})

describe('transfer fields', () => {
  const field = (patch: Partial<TransferField>): TransferField => ({ id: 'f', label: 'F', type: 'text', ...patch })

  it('writes only fields that are not read-only, derived or system', () => {
    expect(isTransferFieldWritable(field({}))).toBe(true)
    expect(isTransferFieldWritable(field({ readOnly: true }))).toBe(false)
    expect(isTransferFieldWritable(field({ derived: true }))).toBe(false)
    expect(isTransferFieldWritable(field({ system: true }))).toBe(false)
  })

  it('imports a match key it never writes', () => {
    const id = field({ id: TRANSFER_ID_FIELD, system: true, readOnly: true, matchKey: true })
    expect(isTransferFieldWritable(id)).toBe(false)
    expect(isTransferFieldImportable(id)).toBe(true)
    expect(isTransferFieldImportable(field({ derived: true }))).toBe(false)
  })

  it('treats only tags, multi-picklists and free lists as lists', () => {
    expect(isTransferListType('tags')).toBe(true)
    expect(isTransferListType('multiPicklist')).toBe(true)
    expect(isTransferListType('list')).toBe(true)
    expect(isTransferListType('picklist')).toBe(false)
    expect(isTransferListType('text')).toBe(false)
  })

  it('reports duplicate ids, unknown types and incomplete picklists and lookups', () => {
    const problems = transferFieldProblems([
      field({ id: 'a' }),
      field({ id: 'a' }),
      field({ id: 'b', type: 'shade' as never }),
      field({ id: 'c', type: 'picklist' }),
      field({ id: 'd', type: 'lookup' }),
      field({ id: 'e', required: true, derived: true }),
      field({ id: '' }),
    ])
    expect(problems).toEqual([
      'Field "a" is declared twice.',
      'Field "b" has unknown type "shade".',
      'Field "c" is a picklist with no picklistId.',
      'Field "d" is a lookup that names no target field.',
      'Field "e" is required but can never be written.',
      'A field labeled "F" has no id.',
    ])
  })
})
