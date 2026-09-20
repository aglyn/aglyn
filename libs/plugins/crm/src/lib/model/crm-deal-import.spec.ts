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
 * The deal-file normalizer (AGL-2662): the contact import's three stages
 * over the deal vocabulary.
 *
 * What is pinned by name: a row is refused here ONLY for a missing title;
 * an amount, a currency, a close date or an owner address that cannot be
 * read is dropped and reported; the pipeline and the stage travel as the
 * names typed, for the server to resolve; and the deals export's own
 * header maps itself, its link columns left alone.
 */

import {
  DEAL_IMPORT_FIELD_LABELS,
  DEAL_IMPORT_FIELDS,
  DEAL_IMPORT_SKIP_LABELS,
  dealImportNameKey,
  dealImportSkippedCsv,
  emptyDealImportResult,
  guessDealImportMapping,
  mapDealImportRow,
  mergeDealImportResults,
  normalizeDealImportRow,
  parseImportAmountCents,
  parseImportDate,
} from './crm-deal-import'

describe('the deal vocabulary', () => {
  it('labels every field and every skip reason', () => {
    for (const field of DEAL_IMPORT_FIELDS) {
      expect(DEAL_IMPORT_FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(DEAL_IMPORT_SKIP_LABELS).sort()).toEqual([
      'missing-title',
      'records-band',
      'unknown-pipeline',
      'unknown-stage',
      'write-failed',
    ])
  })
})

describe('guessDealImportMapping', () => {
  it('reads the deals export header, leaving the columns a file cannot set unmapped', () => {
    const mapping = guessDealImportMapping([
      'Title',
      'Pipeline',
      'Stage',
      'Amount',
      'Currency',
      'Owner',
      'Expected close',
      'Status',
      'Contact',
      'Company',
      'Closed',
      'Lost reason',
      'Notes',
    ])
    expect(mapping).toEqual({
      0: 'title',
      1: 'pipeline',
      2: 'stage',
      3: 'amount',
      4: 'currency',
      5: 'ownerEmail',
      6: 'expectedClose',
      12: 'notes',
    })
  })

  it('reads another product’s headers, each field once', () => {
    expect(guessDealImportMapping(['Deal name', 'Deal value', 'Close date', 'Rep', 'Deal'])).toEqual({
      0: 'title',
      1: 'amount',
      2: 'expectedClose',
      3: 'ownerEmail',
    })
  })
})

describe('mapDealImportRow', () => {
  it('carries the mapped cells verbatim and leaves blanks absent', () => {
    expect(
      mapDealImportRow([' Renewal ', '', '$1,250.00'], { 0: 'title', 1: 'stage', 2: 'amount' }),
    ).toEqual({ title: ' Renewal ', amount: '$1,250.00' })
  })
})

describe('parseImportAmountCents', () => {
  it('reads major units with symbols and separators, and refuses words', () => {
    expect(parseImportAmountCents('1250')).toBe(125_000)
    expect(parseImportAmountCents('$1,250.00')).toBe(125_000)
    expect(parseImportAmountCents('12.345')).toBe(1_235)
    expect(parseImportAmountCents(99.5)).toBe(9_950)
    expect(parseImportAmountCents('-5')).toBeNull()
    expect(parseImportAmountCents('a lot')).toBeNull()
    expect(parseImportAmountCents('')).toBeNull()
  })
})

describe('parseImportDate', () => {
  it('reads a calendar day at noon UTC and an instant as itself', () => {
    expect(parseImportDate('2026-09-30')).toBe(Date.UTC(2026, 8, 30, 12))
    expect(parseImportDate('2026-09-30T09:00:00.000Z')).toBe(Date.UTC(2026, 8, 30, 9))
    expect(parseImportDate('2026-02-30')).toBeNull()
    expect(parseImportDate('September 30')).toBeNull()
    expect(parseImportDate('30/09/2026')).toBeNull()
  })
})

describe('normalizeDealImportRow', () => {
  it('refuses only a missing title', () => {
    expect(normalizeDealImportRow({ amount: '10' })).toEqual({
      ok: false,
      reason: 'missing-title',
      input: '',
    })
    expect(normalizeDealImportRow({ title: '   ' }).ok).toBe(false)
  })

  it('normalizes every readable cell and carries the names as typed', () => {
    const verdict = normalizeDealImportRow({
      title: '  Acme   renewal ',
      pipeline: ' Sales ',
      stage: 'Proposal sent',
      amount: '1,250.50',
      currency: 'EUR',
      ownerEmail: ' Owner@Example.com ',
      expectedClose: '2026-12-01',
      notes: 'Q4',
    })
    expect(verdict).toEqual({
      ok: true,
      row: {
        title: 'Acme renewal',
        pipeline: 'Sales',
        stage: 'Proposal sent',
        amountCents: 125_050,
        currency: 'eur',
        ownerEmail: 'owner@example.com',
        expectedCloseAtMs: Date.UTC(2026, 11, 1, 12),
        notes: 'Q4',
        dropped: [],
      },
    })
  })

  it('drops and names an amount, a currency, a date and an owner it cannot read', () => {
    const verdict = normalizeDealImportRow({
      title: 'Renewal',
      amount: 'lots',
      currency: 'dollars',
      ownerEmail: 'nobody',
      expectedClose: 'soon',
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.row.amountCents).toBeUndefined()
    expect(verdict.row.currency).toBeUndefined()
    expect(verdict.row.ownerEmail).toBeUndefined()
    expect(verdict.row.expectedCloseAtMs).toBeUndefined()
    expect(verdict.row.dropped.map((entry) => entry.field)).toEqual([
      'amount',
      'currency',
      'ownerEmail',
      'expectedClose',
    ])
  })
})

describe('dealImportNameKey', () => {
  it('meets two spellings of one name', () => {
    expect(dealImportNameKey('  Proposal   Sent ')).toBe(dealImportNameKey('proposal sent'))
  })
})

describe('the chunk arithmetic and the skipped file', () => {
  it('sums two results with file-relative indexes and writes the reason by label', () => {
    const total = mergeDealImportResults(
      emptyDealImportResult(),
      {
        received: 2,
        created: 1,
        merged: 0,
        skipped: [{ index: 1, title: 'Renewal', reason: 'unknown-stage' }],
        dropped: { amount: 1 },
        ownersUnresolved: ['x@example.com'],
      },
      200,
    )
    expect(total.created).toBe(1)
    expect(total.skipped).toEqual([{ index: 201, title: 'Renewal', reason: 'unknown-stage' }])
    expect(dealImportSkippedCsv(['Title', 'Stage'], [{ cells: ['Renewal', 'Nope'], reason: 'unknown-stage' }]))
      .toBe('Title,Stage,Skipped because\nRenewal,Nope,No stage by that name in that pipeline')
  })
})
