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
 *
 * @jest-environment node
 */

/**
 * Reading a merchant's contact file. Pure, so there are no doubles at all:
 * the real transfer core reads the columns and the rows (as the job engine
 * does), against the list-member resource's real catalog and header
 * spellings, and the real screening reads what it found.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildTransferFieldCatalog,
  deriveTransferRow,
  matchHeaders,
  matchRows,
} from '@aglyn/aglyn/data-transfer'
import {
  LIST_IMPORT_MAX_ADDRESSES,
  importedBasisReason,
  isRoleAccount,
  purchaseTellColumns,
} from './list-import'
import {
  LIST_MEMBER_ALIASES,
  LIST_MEMBER_MATCH_KEYS,
  listMemberCatalog,
} from './transfer/email-transfer-catalog'

const catalog = buildTransferFieldCatalog(listMemberCatalog())

/** The field each column is proposed for. */
function proposed(headers: string[], samples: string[][] = []): Record<string, string | null> {
  const result = matchHeaders(headers, catalog.fields, {
    dictionaries: [...LIST_MEMBER_ALIASES],
    samples,
  })
  return Object.fromEntries(headers.map((header, column) => [header, result.mapping[column] ?? null]))
}

describe('the columns a list actually arrives with', () => {
  it('reads an address and a name', () => {
    expect(proposed(['Email', 'Name'])).toEqual({ Email: 'email', Name: 'name' })
  })

  it('finds the address column even when its header matches no spelling', () => {
    const found = proposed(
      ['Ref', 'Primary contact e-mail (work)'],
      [['A-1', 'priya@lumen.co'], ['A-2', 'dev@lumen.co']],
    )
    expect(found['Primary contact e-mail (work)']).toBe('email')
  })

  it('reads the opt-in source and date a file declares', () => {
    expect(proposed(['Email', 'Opt-in source', 'Opt-in date'])).toMatchObject({
      'Opt-in source': 'declaredSource',
      'Opt-in date': 'declaredAt',
    })
  })

  it('sends a split name to the contact record, not the membership', () => {
    expect(proposed(['Email', 'First name', 'Last name'])).toMatchObject({
      'First name': 'contact:firstName',
      'Last name': 'contact:lastName',
    })
  })

  it('knows another product’s export', () => {
    expect(proposed(['Email Address', 'OPTIN_TIME'])).toMatchObject({
      'Email Address': 'email',
      OPTIN_TIME: 'declaredAt',
    })
  })
})

describe('the rows', () => {
  const byId = catalog.byId

  it('counts a repeat of the same address once, whatever its casing', () => {
    const rows = ['Priya@Lumen.co', 'priya@lumen.co'].map(
      (cell) => deriveTransferRow(byId, { email: cell }).values,
    )
    const outcomes = matchRows(rows, LIST_MEMBER_MATCH_KEYS, new Map())
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['new', 'duplicateInFile'])
  })

  it('reports a line that is not an address rather than dropping it', () => {
    const read = deriveTransferRow(byId, { email: 'not an address' })
    expect(read.problems.map((problem) => problem.fieldId)).toEqual(['email'])
  })

  it('takes at most as many rows as the importer always took', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '../../../../../plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; transferResources?: Array<{ key: string; limits?: { maxRows: number } }> }> }
    const resource = config.plugins
      .find((plugin) => plugin.id === 'email')
      ?.transferResources?.find((entry) => entry.key === 'email.list-members')
    expect(resource?.limits?.maxRows).toBe(LIST_IMPORT_MAX_ADDRESSES)
  })
})

describe('the mechanical screening', () => {
  it('names role accounts', () => {
    expect(['sales@lumen.co', 'priya@lumen.co', 'info@x.co'].filter(isRoleAccount)).toEqual([
      'sales@lumen.co',
      'info@x.co',
    ])
  })

  it('does not call a personal address a role account', () => {
    expect(isRoleAccount('priya@lumen.co')).toBe(false)
    expect(isRoleAccount('')).toBe(false)
  })

  it('names a column that reads as a purchase tell', () => {
    expect(purchaseTellColumns(['Email', 'Jigsaw ID', 'Append Date'])).toEqual([
      'Jigsaw ID',
      'Append Date',
    ])
    expect(purchaseTellColumns(['Email', 'appended_email'])).toEqual(['appended_email'])
  })

  it('leaves an ordinary column alone', () => {
    expect(purchaseTellColumns(['Email', 'Company'])).toEqual([])
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
    expect(importedBasisReason({ declaredSource: '', declaredAt: '' })).toBe(
      'Imported from a file, attested by the operator.',
    )
  })

  it('always says the operator attested it', () => {
    expect(
      importedBasisReason({ declaredSource: 'Trade show', declaredAt: '' }),
    ).toContain('attested by the operator')
  })
})
