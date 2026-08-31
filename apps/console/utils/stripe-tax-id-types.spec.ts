/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * The tax ID type list is STRIPE'S, and stays Stripe's.
 *
 * The Tax ID card offers ~100 country-specific types, and the type decides how
 * an identifier is printed on the customer's invoice and how a tax authority
 * reads it. A hand-written enum would be wrong within a quarter and wrong
 * silently: the customer picks the nearest available type and the compliance
 * cost is theirs.
 *
 * So the list is generated out of `@stripe/stripe-js` — the only
 * machine-readable copy of it in the tree, since Stripe's REST API has no
 * endpoint that enumerates the types and there is no server-side `stripe` SDK
 * here. This suite is the half that makes generation worth anything: it
 * re-derives the file and fails if the checked-in copy differs, so a dependency
 * bump that adds a jurisdiction turns the build red instead of leaving the
 * picker quietly short of one.
 */

export {}

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isStripeTaxIdType,
  taxIdTypeLabel,
  TAX_ID_TYPE_OPTIONS,
} from './stripe-tax-id-types'
import { STRIPE_TAX_ID_TYPES } from './stripe-tax-id-types.generated'

const REPO_ROOT = resolve(__dirname, '../../..')
const STRIPE_SOURCE = resolve(
  REPO_ROOT,
  'node_modules/@stripe/stripe-js/dist/stripe-js/checkout.d.ts',
)

describe('the tax ID type list is generated from Stripe, not written by us', () => {
  it('matches what @stripe/stripe-js publishes today', () => {
    // Runs the generator's own `--check`, which re-extracts from the installed
    // package and diffs against the committed file. Shelling out rather than
    // re-implementing the extraction in TypeScript is the point: a spec with
    // its own parser proves the two parsers agree, not that the checked-in
    // list matches Stripe.
    expect(() =>
      execFileSync(
        'node',
        ['tools/scripts/generate-stripe-tax-id-types.mjs', '--check'],
        { cwd: REPO_ROOT, stdio: 'pipe' },
      ),
    ).not.toThrow()
  })

  it('CONTROL — the source it reads really does hold the list', () => {
    // A guard that greps a file it cannot open reports "no drift" forever.
    // Prove the read is real with a value known to be present, and prove it is
    // discriminating with one known to be absent — without both, an extractor
    // that silently returned everything would pass the drift check too.
    const source = readFileSync(STRIPE_SOURCE, 'utf8')
    expect(source).toContain('StripeCheckoutTaxIdType')
    expect(source).toContain("'us_ein'")
    expect(source).not.toContain("'zz_aglyn'")
  })

  it('carries the whole list, not a convenient subset', () => {
    // ~100 today. The floor is deliberately far below that: this asserts the
    // generator did not silently produce a handful, and does NOT re-pin a
    // count that a legitimate Stripe addition would break.
    expect(STRIPE_TAX_ID_TYPES.length).toBeGreaterThan(80)
    expect(STRIPE_TAX_ID_TYPES).toContain('us_ein')
    expect(STRIPE_TAX_ID_TYPES).toContain('au_abn')
    expect(STRIPE_TAX_ID_TYPES).toContain('eu_vat')
  })
})

describe('labels are derived, so a new Stripe type arrives readable', () => {
  it('names the country and the local abbreviation', () => {
    expect(taxIdTypeLabel('us_ein')).toBe('United States EIN')
    expect(taxIdTypeLabel('au_abn')).toBe('Australia ABN')
    expect(taxIdTypeLabel('br_cnpj')).toBe('Brazil CNPJ')
  })

  it('handles the prefix that is not a country', () => {
    expect(taxIdTypeLabel('eu_vat')).toBe('European Union VAT')
    expect(taxIdTypeLabel('eu_oss_vat')).toBe(
      'European Union One Stop Shop VAT',
    )
  })

  it('CONTROL — a type nobody wrote a label for still reads as prose', () => {
    // The whole reason labels are derived. `zw_tin` has no entry anywhere in
    // our code; if this ever needed one, the derivation has stopped working
    // and the next jurisdiction Stripe adds would render as a raw code.
    expect(taxIdTypeLabel('zw_tin')).toBe('Zimbabwe TIN')
  })

  it('shows an unrecognized shape verbatim rather than inventing prose', () => {
    expect(taxIdTypeLabel('nonsense')).toBe('nonsense')
  })
})

describe('the picker can be searched the way a customer would', () => {
  it('matches on the country name, the abbreviation and the raw code', () => {
    const option = TAX_ID_TYPE_OPTIONS.find((row) => row.code === 'us_ein')
    expect(option?.label).toBe('United States EIN')
    expect(option?.searchText).toContain('united states')
    expect(option?.searchText).toContain('ein')
    // The code their accountant handed them. The default MUI filter reads the
    // label only, which is why the card filters on this field instead.
    expect(option?.searchText).toContain('us_ein')
  })

  it('offers every generated type exactly once', () => {
    expect(TAX_ID_TYPE_OPTIONS).toHaveLength(STRIPE_TAX_ID_TYPES.length)
    expect(new Set(TAX_ID_TYPE_OPTIONS.map((row) => row.code)).size).toBe(
      STRIPE_TAX_ID_TYPES.length,
    )
  })

  it('recognizes a real type and refuses an invented one', () => {
    expect(isStripeTaxIdType('gb_vat')).toBe(true)
    expect(isStripeTaxIdType('aglyn_vat')).toBe(false)
    expect(isStripeTaxIdType(undefined)).toBe(false)
  })
})
