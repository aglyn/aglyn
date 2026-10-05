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
  mayBeTransferRecordId,
  rankTransferLookupSuggestions,
  transferLookupKey,
  transferLookupNewName,
  transferLookupNewValue,
} from './lookup'

describe('lookup columns (AGL-3541)', () => {
  it('carries a record to create behind a marker no id holds, and reads the name back', () => {
    expect(transferLookupNewValue('  Acme ')).toBe('new:Acme')
    expect(transferLookupNewName('new:Acme')).toBe('Acme')
    expect(transferLookupNewName('new:  ')).toBeNull()
    expect(transferLookupNewName('a1b2c3d4')).toBeNull()
    expect(transferLookupNewName(42)).toBeNull()
  })

  it('files a choice under the value trimmed and lowercased', () => {
    expect(transferLookupKey('  Acme Inc ')).toBe('acme inc')
    expect(transferLookupKey(null)).toBe('')
  })

  it('asks by id only for a cell that could be one', () => {
    expect(mayBeTransferRecordId('kq3Zp9-Xa_2')).toBe(true)
    expect(mayBeTransferRecordId('Acme Inc')).toBe(false)
    expect(mayBeTransferRecordId('ana@acme.com')).toBe(false)
    expect(mayBeTransferRecordId('abc')).toBe(false)
  })

  it('ranks similar records best first, once each, above the threshold', () => {
    const ranked = rankTransferLookupSuggestions('Acme Incorporated', [
      { recordId: 'c1', label: 'Acme Inc' },
      { recordId: 'c2', label: 'Globex' },
      { recordId: 'c3', label: 'Acme Incorporated Ltd' },
      { recordId: 'c3', label: 'Acme Incorporated Ltd' },
    ])
    expect(ranked.map((entry) => entry.recordId)).toEqual(['c3', 'c1'])
    expect(rankTransferLookupSuggestions('Acme', [{ recordId: 'c1', label: 'Acme' }], { limit: 0 })).toEqual([])
  })
})
