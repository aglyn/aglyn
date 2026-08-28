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
 * NOTHING STORED MEANS NOT COMPUTED — asserted where the zero would be born.
 *
 * The route suite exercises the same rule through a Firestore double, and it
 * cannot see this: that double short-circuits on `exists`, so a `?? 0` added
 * to the mapping below would never run in it and the route suite would stay
 * green over a return printing `0.00` for a period nobody had entered. This
 * file is the layer where such a default would actually be written, so it is
 * the layer that has to refuse one.
 *
 * The distinction the whole module exists to hold: **nobody looked** and
 * **somebody looked and the answer was nothing** are different facts, and only
 * the second is a figure.
 *
 * Synthetic values only.
 */

import {
  taxablePurchasesAuditShape,
  taxablePurchasesEntry,
  taxablePurchasesPeriodKey,
  taxablePurchasesWrite,
  validateTaxablePurchases,
} from './taxable-purchases'

describe('an absent record is not a zero', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('maps %s to no entry at all', (_label, stored) => {
    expect(taxablePurchasesEntry(stored as never, '2026-Q4')).toBeNull()
  })

  it('THE CONTROL: a stored zero IS an entry, and reads 0.00', () => {
    // Without this the suite above would also pass on a module that refused
    // every zero — including the one an operator deliberately entered, which
    // is a real claim and must survive.
    const entry = taxablePurchasesEntry(
      { period: '2026-Q4', amountCents: 0, note: 'Checked the ledger — none' },
      '2026-Q4',
    )
    expect(entry?.amountCents).toBe(0)
    expect(entry?.amountDollars).toBe('0.00')
  })

  it('treats an unreadable figure as unentered rather than as zero', () => {
    // A corrupted row prints `not computed`, which is honest. Coercing it to
    // zero would file a number nobody derived from a row nobody can read.
    for (const amountCents of [NaN, undefined, 'lots', null]) {
      expect(
        taxablePurchasesEntry(
          { period: '2026-Q4', amountCents, note: 'x' } as never,
          '2026-Q4',
        ),
      ).toBeNull()
    }
  })

  it('refuses a record belonging to another period', () => {
    // The store keys by period so this cannot arise through it. Asserted
    // anyway: the cost of being wrong is one quarter's figure on another
    // quarter's return.
    expect(
      taxablePurchasesEntry(
        { period: '2026-Q3', amountCents: 41_290, note: 'Q3 ledger' },
        '2026-Q4',
      ),
    ).toBeNull()
    // THE CONTROL: the same record under its OWN period does resolve.
    expect(
      taxablePurchasesEntry(
        { period: '2026-Q3', amountCents: 41_290, note: 'Q3 ledger' },
        '2026-Q3',
      )?.amountDollars,
    ).toBe('412.90')
  })
})

describe('what may be entered', () => {
  it('refuses a blank amount rather than storing it as zero', () => {
    const refusal = validateTaxablePurchases({
      period: '2026-Q4',
      amount: '   ',
      note: 'nothing typed',
    })
    expect(refusal.error).toContain('blank field is not zero')
    expect(refusal.value).toBeUndefined()
  })

  it('refuses a missing reason, and a negative figure', () => {
    expect(
      validateTaxablePurchases({ period: '2026-Q4', amount: '10.00', note: '' })
        .error,
    ).toContain('reason is required')
    expect(
      validateTaxablePurchases({
        period: '2026-Q4',
        amount: '-10.00',
        note: 'a credit',
      }).error,
    ).toContain('negative')
  })

  it('takes dollars and stores cents, tolerating how people type money', () => {
    for (const [typed, cents] of [
      ['412.90', 41_290],
      ['$412.90', 41_290],
      ['1,234.56', 123_456],
      ['0.00', 0],
      ['7', 700],
    ] as Array<[string, number]>) {
      const proposal = validateTaxablePurchases({
        period: '2026-Q4',
        amount: typed,
        note: 'From the expense ledger',
      })
      expect([typed, proposal.value?.amountCents]).toEqual([typed, cents])
    }
  })

  it('normalizes the period so one quarter is one record', () => {
    expect(taxablePurchasesPeriodKey(' 2026-q4 ')).toBe('2026-Q4')
    expect(taxablePurchasesPeriodKey('2026-09')).toBe('2026-09')
    // THE CONTROL: a key it cannot parse is refused, not coerced. A figure
    // written to an unreachable document id looks exactly like one that was
    // never entered.
    for (const bad of ['2026-Q5', '2026-13', 'last quarter', '', null]) {
      expect([bad, taxablePurchasesPeriodKey(bad)]).toEqual([bad, null])
    }
  })
})

describe('the audit row keeps the figure', () => {
  it('records the amount, unlike the filing configuration’s identifiers', () => {
    // A purchase total is destined for a public filing, not a credential —
    // recording only that "Item 3 changed" would keep the event and lose the
    // one thing anyone comes back for.
    const entry = taxablePurchasesEntry(
      taxablePurchasesWrite({
        period: '2026-Q4',
        amountCents: 41_290,
        note: 'From the Q4 expense ledger',
        actorEmail: 'filer@aglyn.com',
        now: Date.UTC(2026, 9, 5),
      }),
      '2026-Q4',
    )
    expect(taxablePurchasesAuditShape(entry)).toEqual({
      entered: true,
      amountCents: 41_290,
      note: 'From the Q4 expense ledger',
    })
    // …and an absence records as an absence, with no figure invented for it.
    expect(taxablePurchasesAuditShape(null)).toEqual({
      entered: false,
      amountCents: null,
      note: null,
    })
  })
})
