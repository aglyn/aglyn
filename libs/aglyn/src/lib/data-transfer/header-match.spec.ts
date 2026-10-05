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
  compactHeader,
  headerCandidates,
  inferCellType,
  inferredTypeFits,
  mappingIsUsable,
  mappingProblems,
  matchHeaders,
  normalizeHeader,
} from './header-match'
import type { TransferAliasDictionary } from './header-match'
import type { TransferField } from './resource'

const fields: TransferField[] = [
  { id: 'id', label: 'Aglyn ID', type: 'text', system: true, readOnly: true, matchKey: true },
  { id: 'email', label: 'Email', type: 'email', aliases: ['email address', 'e-mail'], required: true },
  { id: 'firstName', label: 'First name', type: 'text', aliases: ['given name'] },
  { id: 'lastName', label: 'Last name', type: 'text', aliases: ['surname', 'family name'] },
  { id: 'phone', label: 'Phone', type: 'phone', aliases: ['telephone'] },
  { id: 'website', label: 'Website', type: 'url' },
  { id: 'createdAt', label: 'Created', type: 'datetime', system: true, readOnly: true },
  { id: 'score', label: 'Score', type: 'integer', derived: true },
  { id: 'custom:status', label: 'Status', type: 'text', custom: true },
  { id: 'stage', label: 'Status stage', type: 'picklist', picklistId: 'stage', aliases: ['status'] },
]

describe('normalizing headers', () => {
  it('folds case, accents, camelCase and punctuation', () => {
    expect(normalizeHeader('First_Name')).toBe('first name')
    expect(normalizeHeader('firstName')).toBe('first name')
    expect(normalizeHeader('E-Mail (Work)')).toBe('e mail work')
    expect(normalizeHeader('Téléphone')).toBe('telephone')
    expect(normalizeHeader('HTTPStatus')).toBe('http status')
    expect(compactHeader('e-mail')).toBe('email')
  })
})

describe('headerCandidates', () => {
  it('scores an exact alias 1, a normalized one 0.95 and a fuzzy one below 0.9', () => {
    expect(headerCandidates('Email', fields)[0]).toMatchObject({ fieldId: 'email', confidence: 1, reason: 'exactAlias' })
    expect(headerCandidates('EMAIL_ADDRESS', fields)[0]).toMatchObject({
      fieldId: 'email',
      confidence: 0.95,
      reason: 'normalizedAlias',
      alias: 'email address',
    })
    const fuzzy = headerCandidates('Emial Adress', fields)[0]
    expect(fuzzy).toMatchObject({ fieldId: 'email', reason: 'fuzzy' })
    expect(fuzzy?.confidence).toBeLessThanOrEqual(0.9)
    expect(fuzzy?.confidence).toBeGreaterThanOrEqual(0.72)
  })

  it('never proposes a derived or read-only field, but does propose a match key', () => {
    expect(headerCandidates('Score', fields)).toEqual([])
    expect(headerCandidates('Created', fields)).toEqual([])
    expect(headerCandidates('Aglyn ID', fields)[0]?.fieldId).toBe('id')
  })

  it('lets a custom field win a tie with a standard one', () => {
    expect(headerCandidates('Status', fields)[0]?.fieldId).toBe('custom:status')
  })

  it('matches a plugin dictionary and names its source', () => {
    const dictionary: TransferAliasDictionary = { source: 'Other product', aliases: { firstName: ['FName__c'] } }
    expect(headerCandidates('FName__c', fields, { dictionaries: [dictionary] })[0]).toMatchObject({
      fieldId: 'firstName',
      reason: 'exactAlias',
      source: 'Other product',
    })
  })

  it('proposes nothing for an empty header or below the threshold', () => {
    expect(headerCandidates('  ', fields)).toEqual([])
    expect(headerCandidates('Favorite sandwich', fields)).toEqual([])
  })
})

describe('inferCellType', () => {
  it('reads what most of the samples look like', () => {
    expect(inferCellType(['a@b.co', 'c@d.org', ''])).toBe('email')
    expect(inferCellType(['https://a.co', 'www.b.org'])).toBe('url')
    expect(inferCellType(['(512) 555-0107', '+1 512 555 0199'])).toBe('phone')
    expect(inferCellType(['2024-01-02', '3/4/2024'])).toBe('date')
    expect(inferCellType(['$12.00', '€3'])).toBe('currency')
    expect(inferCellType(['yes', 'no', 'Y'])).toBe('boolean')
    expect(inferCellType(['12', '1,234.5'])).toBe('number')
    expect(inferCellType(['Acme', 'Globex'])).toBe('text')
    expect(inferCellType(['', ' '])).toBeNull()
  })

  it('says which field types fit a column', () => {
    expect(inferredTypeFits('email', 'email')).toBe(true)
    expect(inferredTypeFits('datetime', 'date')).toBe(true)
    expect(inferredTypeFits('currency', 'number')).toBe(true)
    expect(inferredTypeFits('text', 'number')).toBe(false)
    expect(inferredTypeFits('picklist', 'text')).toBe(true)
  })
})

describe('matchHeaders', () => {
  it('proposes one field per column with confidence and reason', () => {
    const result = matchHeaders(['E-mail', 'Given Name', 'surname', 'Notes'], fields)
    expect(result.mapping).toEqual({ 0: 'email', 1: 'firstName', 2: 'lastName' })
    expect(result.proposals[3]).toMatchObject({ fieldId: null, confidence: 0, reason: null })
    expect(result.unmappedRequired).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('gives a field to the stronger of two columns and reports the clash', () => {
    const result = matchHeaders(['Email_Address', 'Email'], fields)
    expect(result.mapping[1]).toBe('email')
    expect(result.proposals[0]).toMatchObject({ lostField: 'email' })
    expect(result.conflicts).toEqual([{ fieldId: 'email', columns: [1, 0] }])
  })

  it('marks required fields nobody proposed', () => {
    expect(matchHeaders(['First name'], fields).unmappedRequired).toEqual(['email'])
  })

  it('lets sample cells break a near tie between fuzzy candidates', () => {
    const tied: TransferField[] = [
      { id: 'mobileCarrier', label: 'Mobile carrier', type: 'text' },
      { id: 'mobilePhone', label: 'Mobile phone', type: 'phone' },
    ]
    const plain = matchHeaders(['Mobile'], tied, { threshold: 0.5 })
    const informed = matchHeaders(['Mobile'], tied, { threshold: 0.5, samples: [['(512) 555-0107'], ['512-555-0199']] })
    expect(plain.mapping[0]).toBe('mobileCarrier')
    expect(plain.proposals[0]?.alternatives.map((entry) => entry.fieldId)).toEqual(['mobilePhone'])
    expect(informed.mapping[0]).toBe('mobilePhone')
    expect(informed.proposals[0]?.inferredType).toBe('phone')
  })

  it('offers the one open field of a distinctive type when the header says nothing', () => {
    const result = matchHeaders(['Column A', 'Column B'], fields, {
      samples: [
        ['jane@example.com', 'https://example.com'],
        ['bob@example.org', 'https://example.org'],
      ],
    })
    expect(result.proposals[0]).toMatchObject({ fieldId: 'email', reason: 'typeInference', confidence: 0.55, inferredType: 'email' })
    expect(result.proposals[1]).toMatchObject({ fieldId: 'website', reason: 'typeInference' })
  })
})

describe('mappingProblems', () => {
  it('finds duplicate targets, missing required fields and unimportable targets', () => {
    const problems = mappingProblems({ 0: 'firstName', 1: 'firstName', 2: 'score', 3: 'nope', 4: null }, fields)
    expect(problems).toEqual({
      duplicates: [{ fieldId: 'firstName', columns: [0, 1] }],
      unmappedRequired: ['email'],
      invalid: [
        { column: 2, fieldId: 'score' },
        { column: 3, fieldId: 'nope' },
      ],
    })
    expect(mappingIsUsable(problems)).toBe(false)
    expect(mappingIsUsable(mappingProblems({ 0: 'email' }, fields))).toBe(true)
  })
})
