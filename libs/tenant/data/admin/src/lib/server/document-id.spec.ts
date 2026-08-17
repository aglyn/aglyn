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
 * The one-opaque-component rule (AGL-1771).
 *
 * A spec that only restated the predicate's own clauses would prove nothing —
 * it would pass against any regex, including a wrong one. So the clause tests
 * below are joined by a CLOSURE test: every accepted value must land at a
 * single-component path through a `.doc()` double that reproduces the real
 * one's behaviour, and every rejected value must be a value that double either
 * throws on or silently nests. That is the property the predicate exists to
 * guarantee, stated against the mechanism rather than against itself.
 */

import { isDocumentId, MAX_DOCUMENT_ID_BYTES } from './document-id'

// ---------------------------------------------------------------------------
// A `.doc()` faithful to the three behaviours that make this necessary
// ---------------------------------------------------------------------------

type DocOutcome =
  | { kind: 'document'; path: string }
  | { kind: 'nested'; path: string }
  | { kind: 'threw'; reason: 'odd-component-count' | 'reserved' }

/**
 * What `firestore.collection('hosts').doc(id)` really does.
 *
 * `.doc()` appends a SLASH-SEPARATED path and refuses it only when the
 * resulting component count comes out odd; reserved `__…__` components answer
 * `INVALID_ARGUMENT`. Both refusals are SYNCHRONOUS throws, before any await.
 */
function collectionDoc(collectionPath: string, id: string): DocOutcome {
  const full = `${collectionPath}/${id}`
  const parts = full.split('/')
  if (parts.length % 2 !== 0) {
    return { kind: 'threw', reason: 'odd-component-count' }
  }
  if (parts.some((part) => /^__.*__$/.test(part))) {
    return { kind: 'threw', reason: 'reserved' }
  }
  // Deeper than `{collection}/{id}` means the caller named the nesting.
  return {
    kind:
      parts.length === collectionPath.split('/').length + 1
        ? 'document'
        : 'nested',
    path: full,
  }
}

/** Every id shape a caller can supply, accepted or not. */
const CANDIDATES: unknown[] = [
  'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  'cart-1',
  'AbC_123.xyz',
  'camp-1',
  '1',
  'a'.repeat(MAX_DOCUMENT_ID_BYTES),
  '',
  'a/b',
  'a/b/c',
  'a/b/c/d',
  '/leading',
  'trailing/',
  '.',
  '..',
  '__missing__',
  '__id__',
  'a'.repeat(MAX_DOCUMENT_ID_BYTES + 1),
  '😀'.repeat(376),
  42,
  null,
  undefined,
  {},
  ['a'],
]

describe('isDocumentId is exactly the rule `.doc()` needs', () => {
  it('accepts nothing that `.doc()` would nest or throw on', () => {
    const escapes = CANDIDATES.filter(isDocumentId).filter((id) => {
      const outcome = collectionDoc('hosts/host-1/campaigns', id)
      return outcome.kind !== 'document'
    })

    expect(escapes).toEqual([])
  })

  it('refuses nothing without a Firestore reason for refusing it', () => {
    // The other direction, so the predicate cannot buy its safety by simply
    // refusing everything. The double above only models `.doc()`'s PATH
    // ARITHMETIC, and three of Firestore's four id constraints are not
    // arithmetic at all — so this asks a different question: every refused
    // string must be refused for one of the documented reasons, and adding a
    // clause of taste (no uppercase, hex only) would leave a value here with
    // no reason attached.
    const reasonFor = (id: string): string | null => {
      if (id === '') return 'empty'
      if (id.includes('/')) return 'names a path'
      if (id === '.' || id === '..') return 'traversal'
      if (/^__.*__$/.test(id)) return 'reserved'
      if (Buffer.byteLength(id, 'utf8') > MAX_DOCUMENT_ID_BYTES)
        return 'oversize'
      return null
    }
    const unexplained = CANDIDATES.filter(
      (id) => typeof id === 'string' && !isDocumentId(id),
    ).filter((id) => reasonFor(id as string) === null)

    expect(unexplained).toEqual([])
  })
})

describe('isDocumentId', () => {
  it('accepts an ordinary opaque id', () => {
    expect(isDocumentId('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(true)
    expect(isDocumentId('AbC_123.xyz')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['a nested path', 'a/b/c'],
    ['an even-component path', 'a/b'],
    ['a leading slash', '/leading'],
    ['a trailing slash', 'trailing/'],
    ['self', '.'],
    ['parent', '..'],
    ['a reserved id', '__missing__'],
    ['not a string', 42],
    ['absent', undefined],
    ['null', null],
    ['an object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isDocumentId(value)).toBe(false)
  })

  it('counts BYTES against the ceiling, not characters', () => {
    expect(isDocumentId('a'.repeat(MAX_DOCUMENT_ID_BYTES))).toBe(true)
    expect(isDocumentId('a'.repeat(MAX_DOCUMENT_ID_BYTES + 1))).toBe(false)
    // 4 bytes each in UTF-8: 1504 bytes in 376 characters. A `.length` check
    // would have let this through.
    expect('😀'.repeat(376).length).toBeLessThan(MAX_DOCUMENT_ID_BYTES)
    expect(isDocumentId('😀'.repeat(376))).toBe(false)
  })

  it('does not reject an id that merely contains a dot or underscores', () => {
    // Only the exact `.`/`..` forms traverse, and only `__…__` is reserved.
    expect(isDocumentId('.hidden')).toBe(true)
    expect(isDocumentId('a..b')).toBe(true)
    expect(isDocumentId('__leading')).toBe(true)
    expect(isDocumentId('a__b__c')).toBe(true)
  })
})
