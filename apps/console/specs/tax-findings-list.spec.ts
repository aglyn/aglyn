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
 * The tax-return findings list is filtered where it is computed, over the
 * period's complete read, and refuses every clause when the read was cut
 * short (AGL-3321). A finding is stored on no document, so there is no
 * Firestore query to put a clause on; this is the listed exception.
 */

import { serveTaxFindings } from '../utils/server/tax-findings-list'
import type { TaxFindingListRow } from '../utils/tax-findings-list'

const row = (invoiceId: string, extra: Partial<TaxFindingListRow> = {}): TaxFindingListRow => ({
  invoiceId,
  $id: invoiceId,
  orgId: 'org-1',
  jurisdiction: 'US-TX',
  grossDollars: '10.00',
  taxDollars: '0.66',
  paidAt: '2026-09-15T12:00:00.000Z',
  stripeUrl: null,
  findings: [],
  groups: ['untaxedRows'],
  ...extra,
})

const ROWS = [
  row('in_a'),
  row('in_b', { jurisdiction: 'unknown', groups: ['rowsMissingAddress', 'untaxedRows'] }),
  row('in_c', { orgId: 'org-2', groups: ['rowsMissingPaidAt'], paidAt: null }),
]

const ask = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
  extra: { cursor?: string | null; pageSize?: number } = {},
) => ({ clauses, search, cursor: extra.cursor ?? null, pageSize: extra.pageSize ?? 25, sort: null })

describe('serveTaxFindings', () => {
  it('answers every clause and the search over every row, then pages', () => {
    const answer = serveTaxFindings(
      ROWS,
      ask([{ field: 'groups', op: 'equals', value: 'untaxedRows' }], ['unknown']),
      true,
    )
    expect(answer.rows.map((entry) => entry.invoiceId)).toEqual(['in_b'])
    expect(answer.refused).toEqual([])
  })

  it('matches a finding as a member of the row’s findings, not a substring', () => {
    const answer = serveTaxFindings(ROWS, ask([{ field: 'groups', op: 'isAnyOf', value: 'rowsMissingPaidAt' }]), true)
    expect(answer.rows.map((entry) => entry.invoiceId)).toEqual(['in_c'])
  })

  it('pages by the invoice id of the last row shown', () => {
    const first = serveTaxFindings(ROWS, ask([], [], { pageSize: 2 }), true)
    expect(first.rows.map((entry) => entry.invoiceId)).toEqual(['in_a', 'in_b'])
    expect(first).toMatchObject({ hasMore: true, nextCursor: 'in_b' })
    const second = serveTaxFindings(ROWS, ask([], [], { pageSize: 2, cursor: 'in_b' }), true)
    expect(second.rows.map((entry) => entry.invoiceId)).toEqual(['in_c'])
    expect(second).toMatchObject({ hasMore: false, nextCursor: null })
  })

  it('refuses every clause and the search over a read the cap cut short', () => {
    const clause = { field: 'jurisdiction', op: 'equals', value: 'US-TX' }
    const answer = serveTaxFindings(ROWS, ask([clause], ['org-2']), false)
    expect(answer.rows).toHaveLength(3)
    expect(answer.refused.map((entry) => entry.clause)).toEqual([clause, 'search'])
    expect(answer.refused[0].reason).toMatch(/narrow the period/)
  })

  it('refuses what the list does not filter by, and applies none of it', () => {
    const answer = serveTaxFindings(ROWS, ask([{ field: 'grossDollars', op: 'equals', value: '10.00' }]), true)
    expect(answer.rows).toHaveLength(3)
    expect(answer.refused).toHaveLength(1)
  })
})
