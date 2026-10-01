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

import { soloConsentGroup } from './consent-groups'
import { readMarketingBasis } from './marketing-consent'
import {
  refusalsOf,
  retainedEntries,
  retainedRefusalCarry,
  withRetainedRefusals,
} from './retained-refusals'

/**
 * A person's "no" outlives the record it was written on (AGL-3338). Each case
 * is asked of `readMarketingBasis` over the merged record as well as of the
 * merge itself, because the merge exists for that reader: a merged shape the
 * reader did not read as declined would be a merge that kept nothing.
 */
describe('withRetainedRefusals', () => {
  const A = soloConsentGroup('site-a')
  const refusal = { marketingConsent: false, marketingConsentAtMs: 1_000, retainedAtMs: 5_000 }
  const retained = { byHost: { 'site-a': refusal }, unscoped: false }
  const basis = (record: Record<string, unknown> | null) => readMarketingBasis(record, A).basis

  it('lays the refusal on an address with no record left at all', () => {
    const merged = withRetainedRefusals(null, retained)
    expect(merged).toEqual({ marketingConsentByHost: { 'site-a': refusal } })
    expect(basis(merged)).toBe('declined')
  })

  it('lays it on a record with no entry for the site', () => {
    const record = { email: 'pat@example.com', marketingConsentByHost: { 'site-b': { marketingConsent: true } } }
    const merged = withRetainedRefusals(record, retained)
    expect(merged?.['marketingConsentByHost']).toEqual({
      'site-a': refusal,
      'site-b': { marketingConsent: true },
    })
    expect(merged?.['email']).toBe('pat@example.com')
    expect(basis(merged)).toBe('declined')
  })

  it('keeps refusing over a grant that is older, as old, or undated', () => {
    for (const grant of [
      { marketingConsent: true, marketingConsentAtMs: 999 },
      { marketingConsent: true, marketingConsentAtMs: 1_000 },
      { marketingConsent: true },
    ]) {
      const merged = withRetainedRefusals({ marketingConsentByHost: { 'site-a': grant } }, retained)
      expect(basis(merged)).toBe('declined')
    }
  })

  it('lets a strictly newer grant stand — the person changed their mind', () => {
    const grant = { marketingConsent: true, marketingConsentAtMs: 1_001 }
    const merged = withRetainedRefusals({ marketingConsentByHost: { 'site-a': grant } }, retained)
    expect(merged?.['marketingConsentByHost']).toEqual({ 'site-a': grant })
    expect(basis(merged)).toBe('granted')
  })

  it('dates a refusal the person gave no date by when it was retained', () => {
    const undated = { byHost: { 'site-a': { marketingConsent: false, retainedAtMs: 5_000 } }, unscoped: false }
    const before = { marketingConsentByHost: { 'site-a': { marketingConsent: true, marketingConsentAtMs: 4_999 } } }
    const after = { marketingConsentByHost: { 'site-a': { marketingConsent: true, marketingConsentAtMs: 5_001 } } }
    expect(basis(withRetainedRefusals(before, undated))).toBe('declined')
    expect(basis(withRetainedRefusals(after, undated))).toBe('granted')
  })

  it('keeps the record’s own refusal a refusal', () => {
    const own = { marketingConsent: false, marketingConsentAtMs: 9_000 }
    const merged = withRetainedRefusals({ marketingConsentByHost: { 'site-a': own } }, retained)
    expect(basis(merged)).toBe('declined')
  })

  it('lays the unscoped refusal on only where the record answers nothing at the top', () => {
    const unscoped = { byHost: {}, unscoped: true }
    expect(withRetainedRefusals(null, unscoped)).toEqual({ marketingConsentByHost: {}, marketingConsent: false })
    expect(basis(withRetainedRefusals(null, unscoped))).toBe('declined')
    expect(withRetainedRefusals({ marketingConsent: true }, unscoped)?.['marketingConsent']).toBe(true)
  })

  it('changes nothing when nothing was retained, `null` included', () => {
    const record = { email: 'pat@example.com' }
    expect(withRetainedRefusals(record, null)).toBe(record)
    expect(withRetainedRefusals(null, null)).toBeNull()
    expect(withRetainedRefusals(undefined, undefined)).toBeNull()
    expect(withRetainedRefusals(record, { byHost: {}, unscoped: false })).toBe(record)
  })
})

describe('refusalsOf', () => {
  it('reads every site’s refusal and the unscoped one, and nothing else', () => {
    expect(
      refusalsOf({
        marketingConsent: false,
        marketingConsentByHost: {
          a: { marketingConsent: false, marketingConsentAtMs: 1 },
          b: { marketingConsent: true },
          c: 'not an entry',
          d: { confirmedAt: null },
        },
      }),
    ).toEqual({ byHost: { a: { marketingConsent: false, marketingConsentAtMs: 1 } }, unscoped: true })
  })

  it('answers null for a record with no refusal, or none at all', () => {
    expect(refusalsOf({ marketingConsent: true, marketingConsentByHost: { a: { marketingConsent: true } } })).toBeNull()
    expect(refusalsOf({})).toBeNull()
    expect(refusalsOf(null)).toBeNull()
  })

  it('reads a retained document back as the refusals it holds', () => {
    const stored = {
      marketingConsentByHost: retainedEntries(
        { byHost: { a: { marketingConsent: false, marketingConsentAtMs: 1 } }, unscoped: false },
        'con_1',
        10,
      ),
      retainedAtMs: 10,
    }
    expect(refusalsOf(stored)).toEqual({
      byHost: {
        a: { marketingConsent: false, marketingConsentAtMs: 1, retainedAtMs: 10, retainedFromContactId: 'con_1' },
      },
      unscoped: false,
    })
  })
})

describe('retainedRefusalCarry', () => {
  const carry = { toHostId: 'shop', fromHostId: 'blog' }
  const refusal = { marketingConsent: false, marketingConsentAtMs: 1, retainedAtMs: 2 }

  it('gives the receiving site the refusal, by dotted path, with its provenance', () => {
    expect(retainedRefusalCarry({ marketingConsentByHost: { blog: refusal } }, carry, 'chg-1')).toEqual({
      'marketingConsentByHost.shop': { ...refusal, carriedFromHostId: 'blog', carriedByChangeId: 'chg-1' },
    })
  })

  it('never overwrites an entry the receiving site has, so a second run writes nothing', () => {
    const once = { marketingConsentByHost: { blog: refusal, shop: { marketingConsent: false } } }
    expect(retainedRefusalCarry(once, carry, 'chg-1')).toBeNull()
  })

  it('carries nothing from a site that holds no refusal', () => {
    expect(retainedRefusalCarry({ marketingConsentByHost: { other: refusal } }, carry, 'chg-1')).toBeNull()
    expect(retainedRefusalCarry(null, carry, 'chg-1')).toBeNull()
  })
})
