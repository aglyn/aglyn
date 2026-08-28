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
  centsToDollars,
  defaultTaxReturnPeriod,
  storefrontPlatformLiableCents,
  taxReturnAttention,
  taxReturnCsv,
  taxReturnCsvFilename,
  taxReturnFilingLines,
  taxReturnJurisdictionRows,
  taxReturnPeriodOptions,
  taxReturnRegistration,
  taxReturnWebfileLines,
  TAX_REGISTRATION_UNSET,
  TX_JURISDICTION,
  type TaxReturnPayload,
} from './tx-return-webfile'

/**
 * A SYNTHETIC registration (AGL-2021).
 *
 * Deliberately not-a-real-number, and that is the point of the whole issue:
 * this spec previously asserted Aglyn LLC's actual Webfile number as a string
 * literal, which is how it survived the first removal attempt — the constants
 * went, the spec still pinned them, and they came back. A spec must prove the
 * MECHANISM (whatever is configured reaches the CSV), never the value. If this
 * fixture ever needs to be a real number for a test to pass, the test is wrong.
 */
const FAKE_REGISTRATION = {
  webfileNumber: 'RT000000',
  taxpayerNumber: '00000000000',
}

/** A clean period: two Texas invoices, nothing unreadable. */
function cleanPayload(): TaxReturnPayload {
  return {
    registration: { ...FAKE_REGISTRATION },
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 2,
      totalSalesCents: 20000,
      taxableSalesCents: 16000,
      taxCollectedCents: 1320,
      byJurisdiction: {
        // The working-paper fields joined `TaxReturnJurisdiction` with
        // AGL-2329. Empty here: this file is about the Webfile MAPPING, and
        // the papers' own arithmetic is proved in `tx-return.spec.ts`.
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
          taxabilityReasons: {},
          rates: [],
        },
        'US-CA': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
          taxabilityReasons: {},
          rates: [],
        },
      },
      refunds: {
        rowsRefundedInPeriod: 0,
        refundedGrossCents: 0,
        estimatedRefundedTaxCents: 0,
        chargedBackCents: 0,
        rowsChargedBack: 0,
      },
      attention: {
        untaxedRows: 0,
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsWithNetMismatch: 0,
      },
    },
    rows: [
      {
        invoiceId: 'in_tx',
        orgId: 'org_a',
        paidAt: '2026-09-02T00:00:00.000Z',
        grossCents: 10660,
        taxCents: 660,
        taxableSalesCents: 8000,
        state: 'TX',
        country: 'US',
        automaticTax: true,
        refundedCents: 0,
      },
      {
        invoiceId: 'in_ca',
        orgId: 'org_b',
        paidAt: '2026-09-03T00:00:00.000Z',
        grossCents: 10660,
        taxCents: 660,
        taxableSalesCents: 8000,
        state: 'CA',
        country: 'US',
        automaticTax: true,
        refundedCents: 0,
      },
    ],
  }
}

describe('centsToDollars', () => {
  it('states cents as filing dollars', () => {
    expect(centsToDollars(123456)).toBe('1234.56')
    expect(centsToDollars(0)).toBe('0.00')
    expect(centsToDollars(5)).toBe('0.05')
  })

  it('answers 0.00 rather than NaN for an unreadable figure', () => {
    // A return that prints "NaN" is a return nobody can file.
    expect(centsToDollars(undefined)).toBe('0.00')
    expect(centsToDollars('not a number')).toBe('0.00')
  })
})

describe('taxReturnAttention', () => {
  it('reads a clean period as clean, with nothing to render', () => {
    const verdict = taxReturnAttention(cleanPayload())
    expect(verdict.clean).toBe(true)
    expect(verdict.total).toBe(0)
    expect(verdict.items).toEqual([])
  })

  // The guard, proven able to fail: flip ONE field on the clean fixture and
  // the verdict must stop being clean. Without this, `clean: true` would be
  // a constant nobody notices.
  it.each([
    ['truncated', (p: TaxReturnPayload) => (p.truncated = true), 'blocking'],
    ['undatedRows', (p: TaxReturnPayload) => (p.undatedRows = 3), 'blocking'],
    [
      'untaxedRows',
      (p: TaxReturnPayload) => (p.summary.attention.untaxedRows = 1),
      'review',
    ],
    [
      'rowsMissingTaxableBase',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingTaxableBase = 1),
      'review',
    ],
    [
      'rowsMissingAddress',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingAddress = 1),
      'review',
    ],
    [
      'nonUsdRows',
      (p: TaxReturnPayload) => (p.summary.attention.nonUsdRows = 1),
      'review',
    ],
    [
      'rowsMissingPaidAt',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingPaidAt = 1),
      'review',
    ],
  ])('surfaces %s as a %s finding', (id, mutate, severity) => {
    const payload = cleanPayload()
    mutate(payload)
    const verdict = taxReturnAttention(payload)
    expect(verdict.clean).toBe(false)
    const item = verdict.items.find((entry) => entry.id === id)
    expect(item).toBeTruthy()
    expect(item.severity).toBe(severity)
    expect(item.detail.length).toBeGreaterThan(0)
  })

  it('counts undated rows at their real count, not as a flag', () => {
    const payload = cleanPayload()
    payload.undatedRows = 7
    const verdict = taxReturnAttention(payload)
    expect(verdict.blocking).toBe(7)
    expect(verdict.total).toBe(7)
  })

  it('orders blocking findings ahead of review findings', () => {
    const payload = cleanPayload()
    payload.summary.attention.nonUsdRows = 4
    payload.undatedRows = 1
    const verdict = taxReturnAttention(payload)
    expect(verdict.items.map((item) => item.id)).toEqual([
      'undatedRows',
      'nonUsdRows',
    ])
    expect(verdict.blocking).toBe(1)
    expect(verdict.review).toBe(4)
  })

  /*==========================================
   * THE TWO FIELDS THAT HAD NO SURFACE (AGL-2329).
   *
   * `netCents` was stored and its only consumer explicitly refused it;
   * `chargedBackCents` was maintained by the billing webhook and read only
   * by the webhook. Both now reach the preparer's attention list, and both
   * are `review` rather than `blocking` on purpose — the totals here are
   * recomputed and therefore still right; what is in question is a row and a
   * treatment.
   *=========================================*/
  it('raises a stored net that contradicts the arithmetic', () => {
    const payload = cleanPayload()
    payload.summary.attention.rowsWithNetMismatch = 3
    const verdict = taxReturnAttention(payload)
    const item = verdict.items.find(
      (entry) => entry.id === 'rowsWithNetMismatch',
    )
    expect(item?.count).toBe(3)
    // The COUNT it was given, not a presence flag: a mapper hardcoding 1
    // would satisfy "the item appears" and fail here.
    expect(item?.severity).toBe('review')
    expect(verdict.blocking).toBe(0)
    expect(verdict.review).toBe(3)
    expect(verdict.clean).toBe(false)
    // And it stays silent when the rows agree — an always-on alarm is one
    // nobody reads.
    expect(
      taxReturnAttention(cleanPayload()).items.find(
        (entry) => entry.id === 'rowsWithNetMismatch',
      ),
    ).toBeUndefined()
  })

  it('states the bank-reversed cents as their own finding', () => {
    const payload = cleanPayload()
    payload.summary.refunds.refundedGrossCents = 9000
    payload.summary.refunds.chargedBackCents = 2500
    const item = taxReturnAttention(payload).items.find(
      (entry) => entry.id === 'chargedBackCents',
    )
    // The chargeback figure, NOT the refund figure beside it — a mapper
    // reading the wrong key off the same object is the likeliest mistake
    // here, and the two numbers differ so it cannot pass.
    expect(item?.count).toBe(2500)
    expect(item?.count).not.toBe(9000)
    expect(item?.detail).toContain('SUBSET')
    expect(
      taxReturnAttention(cleanPayload()).items.find(
        (entry) => entry.id === 'chargedBackCents',
      ),
    ).toBeUndefined()
  })

  it('does NOT call "no data loaded" clean', () => {
    // Nothing read is not the same as nothing wrong.
    const verdict = taxReturnAttention(null)
    expect(verdict.clean).toBe(false)
    expect(verdict.total).toBe(0)
  })
})

describe('taxReturnWebfileLines', () => {
  it('files the TEXAS bucket, not the platform totals', () => {
    const lines = taxReturnWebfileLines(cleanPayload())
    const byLabel = Object.fromEntries(
      lines.map((line) => [line.label, line.dollars]),
    )
    // Platform totals are 200.00/160.00/13.20 across TX and CA; the return
    // must carry only Texas's half.
    expect(byLabel['Total Texas sales']).toBe('100.00')
    expect(byLabel['Taxable sales']).toBe('80.00')
    expect(byLabel['Tax collected (reconciliation)']).toBe('6.60')
    expect(byLabel['Texas transactions']).toBe('1')
  })

  it('states taxable purchases as not computed rather than as zero', () => {
    const line = taxReturnWebfileLines(cleanPayload()).find(
      (entry) => entry.label === 'Taxable purchases',
    )
    expect(line.dollars).toBeNull()
    expect(line.note).toContain('NOT COMPUTED')
  })

  it('reports 0.00 for a period with no Texas sales at all', () => {
    const payload = cleanPayload()
    delete payload.summary.byJurisdiction[TX_JURISDICTION]
    const byLabel = Object.fromEntries(
      taxReturnWebfileLines(payload).map((line) => [line.label, line.dollars]),
    )
    expect(byLabel['Total Texas sales']).toBe('0.00')
    expect(byLabel['Texas transactions']).toBe('0')
  })
})

describe('the working papers reach the rows the page renders (AGL-2329)', () => {
  const withPapers = () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-TX'].taxabilityReasons = {
      taxable_basis_reduced: {
        lines: 2,
        taxableAmountCents: 8000,
        taxCollectedCents: 660,
      },
      // ZERO tax, and the reason it is zero. This is the entry a total can
      // never carry and the one an examiner asks about first.
      not_collecting: {
        lines: 1,
        taxableAmountCents: 5000,
        taxCollectedCents: 0,
      },
    }
    payload.summary.byJurisdiction['US-TX'].rates = [
      {
        taxRateId: 'txr_tx_state',
        percentage: 6.25,
        rateState: 'TX',
        jurisdiction: 'Texas',
        lines: 2,
        taxableAmountCents: 8000,
        taxCollectedCents: 660,
      },
      {
        taxRateId: 'txr_austin_local',
        percentage: 2,
        rateState: 'TX',
        jurisdiction: 'Austin',
        lines: 1,
        taxableAmountCents: 8000,
        taxCollectedCents: 200,
      },
    ]
    return payload
  }

  it('words each reason and carries its own money', () => {
    const texas = taxReturnJurisdictionRows(withPapers()).find(
      (row) => row.jurisdiction === 'US-TX',
    )!
    // Dearest first, and each with its OWN figures — a mapper reusing the
    // first entry's money is wrong for the second and dies here.
    expect(texas.taxabilityReasons.map((paper) => paper.label)).toEqual([
      'Taxable basis reduced',
      'Not collecting — no registration',
    ])
    expect(
      texas.taxabilityReasons.map((paper) => paper.taxCollectedDollars),
      // $6.60 of tax on an $80 base, and $0.00 on $50 because we do not
      // collect there. Dollars, from cents — the mapper's job.
    ).toEqual(['6.60', '0.00'])
    expect(
      texas.taxabilityReasons.map((paper) => paper.taxableSalesDollars),
    ).toEqual(['80.00', '50.00'])
  })

  it('keeps an unrecognised reason\'s raw code rather than renaming it', () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-TX'].taxabilityReasons = {
      some_future_stripe_reason: {
        lines: 1,
        taxableAmountCents: 100,
        taxCollectedCents: 10,
      },
    }
    const texas = taxReturnJurisdictionRows(payload).find(
      (row) => row.jurisdiction === 'US-TX',
    )!
    // On a filing record, "we do not have a name for this" beats a plausible
    // wrong one — and beats dropping the row, which would stop the papers
    // reconciling with the total above them.
    expect(texas.taxabilityReasons[0].label).toBe('some_future_stripe_reason')
  })

  it('labels a rate with its jurisdiction, percentage and id', () => {
    const texas = taxReturnJurisdictionRows(withPapers()).find(
      (row) => row.jurisdiction === 'US-TX',
    )!
    expect(texas.rates.map((rate) => rate.label)).toEqual([
      'Texas · 6.25% · txr_tx_state',
      'Austin · 2% · txr_austin_local',
    ])
    expect(texas.rates.map((rate) => rate.taxCollectedDollars)).toEqual([
      '6.60',
      '2.00',
    ])
  })

  it('says a rate was not stated instead of printing an empty label', () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-TX'].rates = [
      {
        taxRateId: 'unknown',
        percentage: null,
        rateState: null,
        jurisdiction: null,
        lines: 1,
        taxableAmountCents: 8000,
        taxCollectedCents: 660,
      },
    ]
    const texas = taxReturnJurisdictionRows(payload).find(
      (row) => row.jurisdiction === 'US-TX',
    )!
    // A blank label renders as a stray dash on the page and reads as a bug.
    expect(texas.rates[0].label).toBe('rate not stated')
  })

  it('gives a jurisdiction with no lines EMPTY papers, not the neighbour\'s', () => {
    const rows = taxReturnJurisdictionRows(withPapers())
    const california = rows.find((row) => row.jurisdiction === 'US-CA')!
    expect(california.taxabilityReasons).toEqual([])
    expect(california.rates).toEqual([])
  })
})

describe('the CSV carries the working papers it is named after (AGL-2329)', () => {
  const withPapers = () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-TX'].taxabilityReasons = {
      taxable_basis_reduced: {
        lines: 2,
        taxableAmountCents: 8000,
        taxCollectedCents: 660,
      },
      not_collecting: {
        lines: 1,
        taxableAmountCents: 5000,
        taxCollectedCents: 0,
      },
    }
    payload.summary.byJurisdiction['US-TX'].rates = [
      {
        taxRateId: 'txr_tx_state',
        percentage: 6.25,
        rateState: 'TX',
        jurisdiction: 'Texas',
        lines: 2,
        taxableAmountCents: 8000,
        taxCollectedCents: 660,
      },
    ]
    payload.summary.refunds.refundedGrossCents = 9000
    payload.summary.refunds.chargedBackCents = 2500
    payload.summary.refunds.rowsChargedBack = 1
    return payload
  }

  /**
   * The CSV as rows of cells, so a cell is asserted rather than a substring
   * — a check for the words being "in there somewhere" passes on a file with
   * the figures under the wrong headings.
   *
   * A deliberately naive splitter: it does not understand quoted cells, so
   * every cell asserted below is one with no comma in it. That is a
   * constraint on the ASSERTIONS, not on the CSV.
   */
  const rows = (csv: string) => csv.split('\n').map((line) => line.split(','))

  it('writes a reason row per jurisdiction, with that reason\'s own money', () => {
    const table = rows(taxReturnCsv(withPapers()))
    const reduced = table.find(
      (row) => row[0] === 'US-TX' && row[1] === 'Taxable basis reduced',
    )
    const notCollecting = table.find(
      (row) => row[0] === 'US-TX' && row[1] === 'Not collecting — no registration',
    )
    // Read as CELLS. A substring check would pass on a CSV that had the
    // words somewhere and the figures in the wrong columns.
    expect(reduced?.slice(2)).toEqual(['2', '80.00', '6.60'])
    // The ZERO-tax reason is present and says why — the row a total can
    // never carry and the first thing an examiner asks about.
    expect(notCollecting?.slice(2)).toEqual(['1', '50.00', '0.00'])
  })

  it('names a jurisdiction with no tax lines rather than omitting it', () => {
    const table = rows(taxReturnCsv(withPapers()))
    // US-CA has no papers in this fixture. Omitting it would let a reader
    // conclude the jurisdiction was not in the period at all, when the
    // table above it says otherwise.
    expect(
      table.find(
        (row) => row[0] === 'US-CA' && row[1] === 'No tax lines recorded',
      ),
    ).toBeDefined()
  })

  it('writes the rate rows with their labels and money', () => {
    const table = rows(taxReturnCsv(withPapers()))
    const rate = table.find(
      (row) => row[0] === 'US-TX' && row[1]?.includes('txr_tx_state'),
    )
    expect(rate?.[1]).toBe('Texas · 6.25% · txr_tx_state')
    expect(rate?.slice(2)).toEqual(['2', '80.00', '6.60'])
  })

  it('states bank-reversed money as a subset, on its own row', () => {
    const table = rows(taxReturnCsv(withPapers()))
    const chargeback = table.find((row) =>
      row[0]?.startsWith('Of which reversed by a bank'),
    )
    // $25.00 of the $90.00 refunded. Different figures, so a row copying the
    // refund total is visibly wrong.
    expect(chargeback?.[1]).toBe('25.00')
    expect(
      table.find((row) => row[0] === 'Refunded gross (USD)')?.[1],
    ).toBe('90.00')
    expect(
      table.find((row) => row[0] === 'Rows with a chargeback')?.[1],
    ).toBe('1')
  })
})

describe('taxReturnJurisdictionRows', () => {
  it('puts Texas first, then the rest by receipts', () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-NY'] = {
      transactionCount: 1,
      totalSalesCents: 90000,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
      taxabilityReasons: {},
      rates: [],
    }
    const rows = taxReturnJurisdictionRows(payload)
    expect(rows.map((row) => row.jurisdiction)).toEqual([
      'US-TX',
      'US-NY',
      'US-CA',
    ])
    expect(rows[0].isFilingJurisdiction).toBe(true)
    expect(rows[1].isFilingJurisdiction).toBe(false)
  })
})

describe('taxReturnCsv', () => {
  it('carries the figures, the configured registration and the findings', () => {
    const payload = cleanPayload()
    payload.summary.attention.rowsMissingAddress = 2
    payload.truncated = true
    const csv = taxReturnCsv(payload)
    expect(csv).toContain('2026-Q3')
    // The MECHANISM: whatever the payload carries reaches the file. Asserted
    // against the fixture's own value, never against a real registration.
    expect(csv).toContain(`Webfile number,${FAKE_REGISTRATION.webfileNumber}`)
    expect(csv).toContain(`Taxpayer number,${FAKE_REGISTRATION.taxpayerNumber}`)
    expect(csv).toContain('Total Texas sales,100.00')
    expect(csv).toContain('Rows needing attention,3')
    expect(csv).toContain('BLOCKING,1,Period exceeded the row cap')
    expect(csv).toContain('REVIEW,2,Rows with no readable address')
    expect(csv).toContain('in_tx')
    expect(csv).toContain('in_ca')
  })

  it('says so in the file when nothing needs attention', () => {
    const csv = taxReturnCsv(cleanPayload())
    expect(csv).toContain('Rows needing attention,0')
    expect(csv).toContain('None — every row read cleanly')
    expect(csv).not.toContain('BLOCKING')
  })

  it('quotes a cell containing a comma so columns do not shift', () => {
    const payload = cleanPayload()
    payload.rows[0].orgId = 'Acme, Inc'
    expect(taxReturnCsv(payload)).toContain('"Acme, Inc"')
  })

  it('is empty with no payload rather than emitting a header that looks filed', () => {
    expect(taxReturnCsv(null)).toBe('')
  })
})

/**
 * The registration is CONFIGURATION, not source (AGL-2021).
 *
 * Two things have to hold, and they pull in opposite directions: a configured
 * deployment must get its own real numbers into the working papers, and an
 * unconfigured one must get something that cannot be mistaken for a number.
 */
describe('taxReturnRegistration / the CSV registration lines', () => {
  it('carries whatever is configured — not a value baked into the module', () => {
    // The positive control that would still pass if someone re-added a literal
    // default, so it is paired with the assertion below.
    const payload = cleanPayload()
    payload.registration = {
      webfileNumber: 'RT123456',
      taxpayerNumber: '11111111111',
    }
    const csv = taxReturnCsv(payload)
    expect(csv).toContain('Webfile number,RT123456')
    expect(csv).toContain('Taxpayer number,11111111111')
    // ...and the fixture's value is NOWHERE in it. A module-level default
    // would survive the assertions above; it cannot survive this one.
    expect(csv).not.toContain(FAKE_REGISTRATION.webfileNumber)
    expect(csv).not.toContain(FAKE_REGISTRATION.taxpayerNumber)
  })

  it('says NOT CONFIGURED rather than printing a blank into a filing document', () => {
    const payload = cleanPayload()
    payload.registration = null
    const csv = taxReturnCsv(payload)
    expect(csv).toContain(`Webfile number,${TAX_REGISTRATION_UNSET}`)
    expect(csv).toContain(`Taxpayer number,${TAX_REGISTRATION_UNSET}`)
    // The failure this exists to prevent: a trailing-comma blank cell that a
    // preparer reads as "not filled in yet" and types a number into by hand.
    expect(csv).not.toContain('Webfile number,\n')
    expect(csv).not.toContain('Taxpayer number,\n')
  })

  it('treats a whitespace-only value as absent, not as a blank number', () => {
    const payload = cleanPayload()
    payload.registration = { webfileNumber: '   ', taxpayerNumber: '' }
    expect(taxReturnRegistration(payload)).toMatchObject({
      registrationId: null,
      filingId: null,
      configured: false,
    })
    expect(taxReturnCsv(payload)).toContain(
      `Webfile number,${TAX_REGISTRATION_UNSET}`,
    )
  })

  it('is not "configured" on half a registration', () => {
    const payload = cleanPayload()
    payload.registration = {
      webfileNumber: 'RT123456',
      taxpayerNumber: null,
    }
    const registration = taxReturnRegistration(payload)
    expect(registration.filingId).toBe('RT123456')
    expect(registration.configured).toBe(false)
    // The half that IS set still reaches the file; only the missing half
    // reports absent. Half a registration is not a licence to print nothing.
    const csv = taxReturnCsv(payload)
    expect(csv).toContain('Webfile number,RT123456')
    expect(csv).toContain(`Taxpayer number,${TAX_REGISTRATION_UNSET}`)
  })

  it('reports absent on a payload predating AGL-2021', () => {
    const payload = cleanPayload()
    delete payload.registration
    expect(taxReturnRegistration(payload).configured).toBe(false)
    expect(taxReturnRegistration(null).configured).toBe(false)
  })
})

describe('taxReturnCsvFilename', () => {
  it('names the period', () => {
    expect(taxReturnCsvFilename('2026-Q4')).toBe(
      'aglyn-tx-sales-tax-2026-Q4.csv',
    )
  })

  it('refuses path characters from a period it did not choose', () => {
    expect(taxReturnCsvFilename('../../etc/passwd')).toBe(
      'aglyn-tx-sales-tax-etcpasswd.csv',
    )
  })
})

describe('taxReturnPeriodOptions', () => {
  it('starts at the registration first-taxable-sales quarter', () => {
    const options = taxReturnPeriodOptions(new Date('2026-10-15T00:00:00Z'))
    const quarters = options
      .filter((option) => option.kind === 'quarter')
      .map((option) => option.value)
    expect(quarters).toEqual(['2026-Q4', '2026-Q3'])
    // Nothing before the collection obligation — those cannot be filed.
    expect(options.some((option) => option.value.startsWith('2025'))).toBe(false)
    expect(options).not.toContainEqual(
      expect.objectContaining({ value: '2026-Q2' }),
    )
  })

  it('offers months from September 2026 only, newest first', () => {
    const months = taxReturnPeriodOptions(new Date('2026-11-05T00:00:00Z'))
      .filter((option) => option.kind === 'month')
      .map((option) => option.value)
    expect(months).toEqual(['2026-11', '2026-10', '2026-09'])
  })

  it('never offers a period that has not started', () => {
    const options = taxReturnPeriodOptions(new Date('2026-09-01T00:00:00Z'))
    expect(options.map((option) => option.value)).toEqual([
      '2026-Q3',
      '2026-09',
    ])
  })

  it('extends into the following year without losing the earlier ones', () => {
    const options = taxReturnPeriodOptions(new Date('2027-02-10T00:00:00Z'))
    const quarters = options
      .filter((option) => option.kind === 'quarter')
      .map((option) => option.value)
    expect(quarters).toEqual(['2027-Q1', '2026-Q4', '2026-Q3'])
    const months = options
      .filter((option) => option.kind === 'month')
      .map((option) => option.value)
    expect(months[0]).toBe('2027-02')
    expect(months[months.length - 1]).toBe('2026-09')
  })
})

describe('defaultTaxReturnPeriod', () => {
  it('lands on the last quarter that has fully ended', () => {
    expect(defaultTaxReturnPeriod(new Date('2027-02-10T00:00:00Z'))).toBe(
      '2026-Q4',
    )
  })

  it('falls back to the launch quarter while it is still the only one', () => {
    expect(defaultTaxReturnPeriod(new Date('2026-09-15T00:00:00Z'))).toBe(
      '2026-Q3',
    )
  })
})

/**
 * A JURISDICTION WITH NO EXPORTER GETS A BREAKDOWN, NOT SOMEONE ELSE'S FORM.
 *
 * The platform computes tax against the PLATFORM's Stripe registrations on
 * every `mode: 'stripe'` storefront sale, wherever it is deployed — so an
 * operator running this software in California or the United Kingdom collects
 * the same facilitator liability, and used to be handed Texas Comptroller
 * lines to file it with. The figures were right and the document was for an
 * authority they have never registered with.
 *
 * What this software knows is what it collected and where. What it does not
 * know is any other authority's form. So the breakdown carries the first and
 * says plainly that it is not the second — asserted here in both directions,
 * because a breakdown quietly wearing a form's clothes is the failure mode.
 */
describe('the filing output is selected by jurisdiction', () => {
  const californiaPayload = (): TaxReturnPayload => ({
    ...cleanPayload(),
    registration: {
      jurisdiction: 'US-CA',
      registrationId: 'CDTFA-000000',
      filingId: null,
    },
  })

  const byLabel = (payload: TaxReturnPayload) =>
    Object.fromEntries(
      taxReturnFilingLines(payload).map((line) => [line.label, line.dollars]),
    )

  it('still files Texas from the Webfile lines, unchanged', () => {
    // The dispatcher must not be a rewrite of the Texas path wearing a new
    // name: the same fixture through the new entry point produces exactly the
    // lines the Texas exporter produces.
    const payload = cleanPayload()
    expect(taxReturnFilingLines(payload)).toEqual(taxReturnWebfileLines(payload))
    expect(byLabel(payload)['Total Texas sales']).toBe('100.00')
  })

  it('gives another jurisdiction its OWN figures, from its own bucket', () => {
    const lines = byLabel(californiaPayload())
    // The US-CA bucket is 100.00/80.00/6.60 and Texas's is the same size on
    // purpose in this fixture — so the label, not the number, is what proves
    // which bucket was read.
    expect(lines['Total sales in US-CA']).toBe('100.00')
    expect(lines['Taxable sales']).toBe('80.00')
    expect(lines['Tax collected']).toBe('6.60')
    expect(lines['Transactions']).toBe('1')
    // …and NOT Texas's lines, which is the whole defect.
    expect(lines['Total Texas sales']).toBeUndefined()
  })

  it('claims no form line it cannot know', () => {
    const lines = taxReturnFilingLines(californiaPayload())
    // Every Texas item number is gone, and so is `Taxable purchases` — a Form
    // 01-114 line, not a universal concept. Printing either would assert
    // knowledge of a return this code has never seen.
    expect(lines.every((line) => line.item === '—')).toBe(true)
    expect(lines.some((line) => line.label === 'Taxable purchases')).toBe(false)
  })

  it('still separates the platform-liable storefront tax from the merchant’s', () => {
    // The distinction that must survive generalization: one is money the
    // platform holds under its own registration, the other never touched it.
    const labels = taxReturnFilingLines(californiaPayload()).map(
      (line) => line.label,
    )
    expect(labels).toContain(
      'US-CA storefront tax under the platform’s registration (NOT in the figures above)',
    )
    expect(labels).toContain('US-CA storefront tax under the MERCHANT’s own rate')
  })

  it('reads the storefront liability from the CONFIGURED jurisdiction', () => {
    const payload = californiaPayload()
    payload.storefront = {
      summary: {
        aglynLiable: {
          transactionCount: 1,
          grossCents: 10660,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
          byJurisdiction: {
            'US-CA': {
              transactionCount: 1,
              totalSalesCents: 10000,
              taxableSalesCents: 8000,
              taxCollectedCents: 660,
            },
          },
        },
      },
      truncated: false,
      undatedRows: 0,
      rows: [],
    } as never
    // A Texas-keyed read answers 0 here, and a 0 on this figure reads as
    // "nothing to decide" on the finding that blocks filing.
    expect(storefrontPlatformLiableCents(payload)).toBe(660)
    const finding = taxReturnAttention(payload).items.find(
      (item) => item.id === 'storefrontAglynLiableTax',
    )
    expect(finding).toMatchObject({ severity: 'blocking', count: 660 })
    expect(finding?.label).toContain('US-CA')
  })

  it('puts the configured jurisdiction at the top of the table, not Texas', () => {
    const rows = taxReturnJurisdictionRows(californiaPayload())
    expect(rows[0].jurisdiction).toBe('US-CA')
    expect(rows[0].isFilingJurisdiction).toBe(true)
    expect(rows[1].isFilingJurisdiction).toBe(false)
  })

  it('exports a breakdown that says it is not a return', () => {
    const csv = taxReturnCsv(californiaPayload())
    expect(csv).toContain('FOR MANUAL FILING')
    expect(csv).toContain('not a submittable return')
    expect(csv).toContain('Filing jurisdiction,US-CA')
    expect(csv).toContain('Return breakdown (US-CA only)')
    expect(csv).toContain('Registration number,CDTFA-000000')
    // The Texas document's own headings must be absent — an operator filing
    // in California must not be able to find a Comptroller word in the file.
    expect(csv).not.toContain('Webfile figures (Texas only)')
    expect(csv).not.toContain('Total Texas sales')
    // …while the raw material any return is assembled from is still there:
    // the same figures split by the region the tax was computed for.
    expect(csv).toContain('Aglyn’s own sales by jurisdiction')
    expect(csv).toContain('US-CA,1,100.00,80.00,6.60')
    expect(csv).toContain('US-TX,1,100.00,80.00,6.60')
  })

  it('keeps the Texas export byte-for-byte what it was', () => {
    const csv = taxReturnCsv(cleanPayload())
    expect(csv).toContain('Aglyn — Texas sales tax return working papers')
    expect(csv).toContain('Webfile figures (Texas only)')
    expect(csv).not.toContain('FOR MANUAL FILING')
  })

  it('names the jurisdiction in the exported filename', () => {
    expect(taxReturnCsvFilename('2026-Q4', 'US-CA')).toBe(
      'aglyn-us-ca-sales-tax-breakdown-2026-Q4.csv',
    )
    // Unqualified stays Texas's historical name: a caller predating the
    // setting must not silently start writing a differently-named file.
    expect(taxReturnCsvFilename('2026-Q4')).toBe(
      'aglyn-tx-sales-tax-2026-Q4.csv',
    )
  })
})

/**
 * AN UNCONFIGURED DEPLOYMENT SAYS SO, IN THE WORDS OF ITS OWN JURISDICTION.
 *
 * The blank cell is the failure: a filing document with nothing where a
 * registration number goes reads as "not filled in yet" and gets one written
 * in by hand. What changes with jurisdictions is only WHICH variables the
 * message names — and whether a second identifier is required at all, since
 * requiring a Texas-shaped pair everywhere would leave a correctly configured
 * deployment reading "not configured" forever.
 */
describe('the unconfigured state, per jurisdiction', () => {
  const gbPayload = (
    registration: TaxReturnPayload['registration'],
  ): TaxReturnPayload => ({ ...cleanPayload(), registration })

  it('is configured on one identifier where no second one exists', () => {
    const resolved = taxReturnRegistration(
      gbPayload({ jurisdiction: 'GB', registrationId: 'GB-VAT-000000' }),
    )
    expect(resolved.configured).toBe(true)
    expect(resolved.jurisdiction.code).toBe('GB')
  })

  it('still demands both halves of a Texas registration', () => {
    const resolved = taxReturnRegistration(
      gbPayload({ jurisdiction: 'US-TX', registrationId: '00000000000' }),
    )
    expect(resolved.configured).toBe(false)
  })

  it('writes what to set, not a blank, into the exported papers', () => {
    const csv = taxReturnCsv(gbPayload({ jurisdiction: 'GB' }))
    expect(csv).toContain(`Registration number,${TAX_REGISTRATION_UNSET}`)
    expect(csv).toContain('AGLYN_TAX_REGISTRATION_ID')
    // The optional identifier is reported as optional rather than as a fault:
    // "not configured" on something there is nothing to configure sends a
    // preparer hunting for a number that does not exist.
    expect(csv).toContain('Filing ID,NOT SET — AGLYN_TAX_FILING_ID is optional for GB')
    expect(csv).not.toContain('Registration number,\n')
  })

  it('BLOCKS on a jurisdiction key that can never match a bucket', () => {
    // The silent-zero case: `AGLYN_TAX_JURISDICTION=Texas` matches no bucket,
    // so every figure reads 0.00 on a page that otherwise looks clean. It is
    // reported, never corrected to the default — guessing which authority an
    // operator meant is not a thing a filing document may do.
    const payload = gbPayload({ jurisdiction: 'TEXAS' })
    const verdict = taxReturnAttention(payload)
    expect(verdict.clean).toBe(false)
    const finding = verdict.items.find(
      (item) => item.id === 'jurisdictionUnrecognized',
    )
    expect(finding).toMatchObject({ severity: 'blocking', count: 1 })
    expect(finding?.detail).toContain('AGLYN_TAX_JURISDICTION')
    // …and the figures it would have printed really are zero, which is why
    // the finding has to exist.
    const lines = Object.fromEntries(
      taxReturnFilingLines(payload).map((line) => [line.label, line.dollars]),
    )
    expect(lines['Total sales in TEXAS']).toBe('0.00')
  })

  it('does not raise the finding for a jurisdiction that simply had no sales', () => {
    // A well-formed key with an empty bucket is an ordinary quarter, not a
    // misconfiguration, and must not be dressed up as one.
    const verdict = taxReturnAttention(gbPayload({ jurisdiction: 'DE' }))
    expect(
      verdict.items.some((item) => item.id === 'jurisdictionUnrecognized'),
    ).toBe(false)
  })
})
