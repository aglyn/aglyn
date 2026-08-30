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
 * The rule language, driven from the three questions the feature was asked
 * for by name: everyone who submitted form X, contacts tagged Y, and site
 * members created after Z.
 */

import {
  candidateMatchesDynamicListRule,
  dynamicListRuleIsEmpty,
  normalizeDynamicListRule,
  type DynamicListCandidate,
} from './dynamic-list-rule'

const NOW = Date.UTC(2026, 7, 29)
const DAY = 86_400_000

const match = (
  candidate: Partial<DynamicListCandidate>,
  rule: unknown,
  segment?: { tags?: string[]; sources?: any[] } | null,
) =>
  candidateMatchesDynamicListRule(
    { silo: 'contacts', email: 'dana@example.com', ...candidate } as DynamicListCandidate,
    normalizeDynamicListRule(rule),
    { segment: segment ?? null, nowMs: NOW },
  )

describe('the three questions the feature was asked for', () => {
  it('everyone who submitted form X', () => {
    const rule = { sources: ['formSubmissions'], formNames: ['Contact us'] }
    expect(
      match({ silo: 'formSubmissions', formName: 'Contact us' }, rule),
    ).toBe(true)
    // Case-insensitive, because the name is whatever the merchant typed into
    // the besigner prop and the form posts it back verbatim.
    expect(
      match({ silo: 'formSubmissions', formName: 'CONTACT US' }, rule),
    ).toBe(true)
    expect(
      match({ silo: 'formSubmissions', formName: 'Newsletter' }, rule),
    ).toBe(false)
  })

  it('contacts tagged Y', () => {
    const rule = { sources: ['contacts'], tags: ['vip'] }
    expect(match({ tags: ['VIP'] }, rule)).toBe(true)
    expect(match({ tags: ['regular'] }, rule)).toBe(false)
  })

  it('site members created after Z', () => {
    const rule = {
      sources: ['siteMembers'],
      createdAfterMs: NOW - 7 * DAY,
    }
    expect(
      match({ silo: 'siteMembers', createdAtMs: NOW - 2 * DAY }, rule),
    ).toBe(true)
    expect(
      match({ silo: 'siteMembers', createdAtMs: NOW - 30 * DAY }, rule),
    ).toBe(false)
  })

  /**
   * A record with no creation stamp cannot satisfy an age window. This is the
   * OPPOSITE lean from the consent module's unknown handling and deliberately
   * so: there, an unknown keeps somebody reachable; here, admitting it would
   * add somebody the merchant's rule excluded on purpose.
   */
  it('does not admit an undated record into a dated window', () => {
    expect(
      match(
        { silo: 'siteMembers', createdAtMs: null },
        { sources: ['siteMembers'], createdAfterMs: NOW - 7 * DAY },
      ),
    ).toBe(false)
  })
})

describe('the source dimension', () => {
  it('matches nobody outside the listed silos', () => {
    expect(match({ silo: 'leads' }, { sources: ['contacts'] })).toBe(false)
    expect(match({ silo: 'leads' }, { sources: ['contacts', 'leads'] })).toBe(
      true,
    )
  })

  /**
   * A dimension that does not apply to a silo is SKIPPED, not failed. A rule
   * of "VIP contacts, and site members" must not have its second source
   * silently contribute nobody because members cannot carry tags.
   */
  it('skips a contacts-only filter for a non-contacts silo', () => {
    expect(
      match({ silo: 'siteMembers' }, { sources: ['contacts', 'siteMembers'], tags: ['vip'] }),
    ).toBe(true)
  })

  /** An empty `sources` selects nobody, and says so rather than looking unrun. */
  it('reports a rule with no sources as empty', () => {
    expect(dynamicListRuleIsEmpty(normalizeDynamicListRule({}))).toBe(true)
    expect(match({}, { sources: [] })).toBe(false)
  })

  /**
   * A typo dropped rather than tolerated: a source name that survived
   * normalization would name a silo nothing scans, and the list would
   * materialize a smaller set than the rule appears to describe.
   */
  it('drops an unknown source name', () => {
    expect(normalizeDynamicListRule({ sources: ['contacts', 'customers'] })).toMatchObject(
      { sources: ['contacts'] },
    )
  })
})

describe('behavior filters read what the contact already stores', () => {
  it('filters on order count and lifetime value', () => {
    const rule = {
      sources: ['contacts'],
      behavior: { ordersCountAtLeast: 2, ltvCentsAtLeast: 10_000 },
    }
    expect(match({ ordersCount: 3, ltvCents: 25_000 }, rule)).toBe(true)
    expect(match({ ordersCount: 1, ltvCents: 25_000 }, rule)).toBe(false)
    expect(match({ ordersCount: 3, ltvCents: 500 }, rule)).toBe(false)
  })

  it('filters on recency', () => {
    const rule = {
      sources: ['contacts'],
      behavior: { lastPurchaseWithinDays: 30 },
    }
    expect(match({ lastPurchaseAtMs: NOW - 10 * DAY }, rule)).toBe(true)
    expect(match({ lastPurchaseAtMs: NOW - 60 * DAY }, rule)).toBe(false)
  })

  /**
   * Never-purchased is not lapsed. Answering "bought once and stopped" with
   * everybody who never bought would put the whole audience into a win-back
   * campaign — a filter that reads as narrow and behaves as the widest
   * possible.
   */
  it('does not treat a contact who never purchased as lapsed', () => {
    const rule = { sources: ['contacts'], behavior: { noPurchaseForDays: 90 } }
    expect(match({ lastPurchaseAtMs: NOW - 200 * DAY }, rule)).toBe(true)
    expect(match({ lastPurchaseAtMs: null }, rule)).toBe(false)
  })
})

describe('a saved segment is reused, not reimplemented', () => {
  it('ANDs the segment filters with the rule filters', () => {
    const rule = { sources: ['contacts'], tags: ['vip'] }
    const segment = { tags: [], sources: ['order' as const] }
    // AND across kinds: the contact needs the tag AND the capture source.
    expect(match({ tags: ['vip'], sources: { order: true } }, rule, segment)).toBe(
      true,
    )
    expect(match({ tags: ['vip'], sources: { form: true } }, rule, segment)).toBe(
      false,
    )
  })
})
