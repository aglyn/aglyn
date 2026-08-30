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
 * Reading a merchant's contact file. Pure, so there are no doubles at all:
 * everything here is the real parser, the real screening and the real
 * address normalizer.
 */

import {
  LIST_IMPORT_MAX_ADDRESSES,
  importedBasisReason,
  parseListImport,
  screenListImport,
} from './list-import'

describe('parsing the shapes a list actually arrives in', () => {
  it('reads a CSV with a header', () => {
    const parsed = parseListImport(
      ['Email,Name', 'priya@lumen.co,Priya', 'dev@lumen.co,Dev'].join('\n'),
    )
    expect(parsed.columns).toEqual(['Email', 'Name'])
    expect(parsed.usable).toBe(2)
    expect(parsed.rows[0]).toMatchObject({
      email: 'priya@lumen.co',
      name: 'Priya',
    })
  })

  it('reads a bare column of addresses with no header', () => {
    const parsed = parseListImport('priya@lumen.co\ndev@lumen.co')
    expect(parsed.columns).toEqual([])
    expect(parsed.usable).toBe(2)
  })

  it('does not eat the first address of a headerless file', () => {
    const parsed = parseListImport('priya@lumen.co\ndev@lumen.co')
    expect(parsed.rows.map((row) => row.email)).toEqual([
      'priya@lumen.co',
      'dev@lumen.co',
    ])
  })

  it('finds the address column even when its header matches no alias', () => {
    const parsed = parseListImport(
      ['Ref,Primary contact e-mail (work)', 'A-1,priya@lumen.co'].join('\n'),
    )
    expect(parsed.rows[0].email).toBe('priya@lumen.co')
  })

  it('honors quoted cells containing commas', () => {
    const parsed = parseListImport(
      ['Email,Name', 'priya@lumen.co,"Rao, Priya"'].join('\n'),
    )
    expect(parsed.rows[0].name).toBe('Rao, Priya')
  })

  it('collapses a repeat of the same address, whatever its casing', () => {
    const parsed = parseListImport('Priya@Lumen.co\npriya@lumen.co')
    expect(parsed.usable).toBe(1)
    expect(parsed.duplicates).toBe(1)
  })

  it('reports a line that is not an address rather than dropping it', () => {
    const parsed = parseListImport('priya@lumen.co\nnot an address')
    expect(parsed.unusable).toBe(1)
    expect(parsed.rows.find((row) => !row.email)?.input).toBe('not an address')
  })

  it('stops at the ceiling and says so', () => {
    const many = Array.from(
      { length: LIST_IMPORT_MAX_ADDRESSES + 5 },
      (_, at) => `person${at}@lumen.co`,
    ).join('\n')
    const parsed = parseListImport(many)
    expect(parsed.usable).toBe(LIST_IMPORT_MAX_ADDRESSES)
    expect(parsed.overCeiling).toBe(true)
  })

  it('reads the opt-in source and date a file declares', () => {
    const parsed = parseListImport(
      [
        'Email,Opt-in source,Opt-in date',
        'priya@lumen.co,Trade show,2024-03-01',
      ].join('\n'),
    )
    expect(parsed.rows[0].declaredSource).toBe('Trade show')
    expect(parsed.rows[0].declaredAt).toBe('2024-03-01')
  })

  it('is empty for empty text rather than throwing', () => {
    expect(parseListImport('').usable).toBe(0)
    expect(parseListImport('   ').usable).toBe(0)
  })
})

describe('the mechanical screening', () => {
  it('names role accounts', () => {
    const parsed = parseListImport('sales@lumen.co\npriya@lumen.co\ninfo@x.co')
    const screening = screenListImport(parsed)
    expect(screening.roleAccounts).toEqual(['sales@lumen.co', 'info@x.co'])
  })

  it('does not call a personal address a role account', () => {
    const screening = screenListImport(parseListImport('priya@lumen.co'))
    expect(screening.roleAccounts).toEqual([])
  })

  it('names a column that reads as a purchase tell', () => {
    const parsed = parseListImport(
      ['Email,Jigsaw ID,Append Date', 'priya@lumen.co,1,2'].join('\n'),
    )
    expect(screenListImport(parsed).purchaseTellColumns).toEqual([
      'Jigsaw ID',
      'Append Date',
    ])
  })

  it('leaves an ordinary column alone', () => {
    const parsed = parseListImport(
      ['Email,Company', 'priya@lumen.co,Lumen'].join('\n'),
    )
    expect(screenListImport(parsed).purchaseTellColumns).toEqual([])
  })

  it('refuses nothing — a screened file still counts every address', () => {
    const parsed = parseListImport(
      ['Email,Append', 'sales@lumen.co,yes'].join('\n'),
    )
    expect(parsed.usable).toBe(1)
    expect(screenListImport(parsed).roleAccounts).toHaveLength(1)
  })

  it('says whether the file declares a basis per address', () => {
    const declaring = parseListImport(
      ['Email,Consent source', 'priya@lumen.co,Signup form'].join('\n'),
    )
    expect(screenListImport(declaring).declaresBasis).toBe(true)
    expect(screenListImport(parseListImport('priya@lumen.co')).declaresBasis).toBe(
      false,
    )
  })

  /**
   * A partly-filled column still means the file declares. It is what the
   * attestation copy offers to keep, and a merchant whose export left the
   * source blank on some rows has not stopped declaring on the others.
   */
  it('reports a declaration when only some rows carry one', () => {
    const parsed = parseListImport(
      [
        'Email,Consent source',
        'priya@lumen.co,',
        'dev@lumen.co,Signup form',
      ].join('\n'),
    )
    expect(screenListImport(parsed).declaresBasis).toBe(true)
  })
})

describe('the reason recorded against an imported basis', () => {
  it('carries what the file declared', () => {
    const reason = importedBasisReason({
      declaredSource: 'Trade show',
      declaredAt: '2024-03-01',
    })
    expect(reason).toContain('Trade show')
    expect(reason).toContain('2024-03-01')
  })

  it('is a plain sentence when the file declared nothing', () => {
    expect(
      importedBasisReason({ declaredSource: '', declaredAt: '' }),
    ).toBe('Imported from a file, attested by the operator.')
  })

  it('always says the operator attested it', () => {
    expect(
      importedBasisReason({ declaredSource: 'Trade show', declaredAt: '' }),
    ).toContain('attested by the operator')
  })
})
