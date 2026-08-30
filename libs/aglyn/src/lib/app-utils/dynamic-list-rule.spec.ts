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
  dynamicListRuleListIds,
  dynamicListRuleNeedsEngagement,
  dynamicListRuleWithoutListReference,
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
    const segment = { tags: [] as string[], sources: ['order' as const] }
    // AND across kinds: the contact needs the tag AND the capture source.
    expect(match({ tags: ['vip'], sources: { order: true } }, rule, segment)).toBe(
      true,
    )
    expect(match({ tags: ['vip'], sources: { form: true } }, rule, segment)).toBe(
      false,
    )
  })
})

/*==========================================
 * ENGAGEMENT — "opened in the last 30 days".
 *
 * The question the whole roll-up exists to make answerable. The assertions
 * below are as much about the two LEANS as about the arithmetic: the "within"
 * arms exclude somebody with no record, the "not for" arms include them, and
 * the two together must never both match the same person.
 *=========================================*/

describe('opened in the last 30 days', () => {
  const OPENED_30 = {
    sources: ['contacts'],
    engagement: { openedWithinDays: 30 },
  }

  it('matches a person who opened inside the window', () => {
    expect(match({ lastOpenedAtMs: NOW - 10 * DAY }, OPENED_30)).toBe(true)
  })

  it('excludes a person whose last open is outside it', () => {
    expect(match({ lastOpenedAtMs: NOW - 31 * DAY }, OPENED_30)).toBe(false)
  })

  it('holds at the boundary itself', () => {
    expect(match({ lastOpenedAtMs: NOW - 30 * DAY }, OPENED_30)).toBe(true)
    expect(match({ lastOpenedAtMs: NOW - 30 * DAY - 1 }, OPENED_30)).toBe(false)
  })

  it('excludes a person with no open on record', () => {
    expect(match({ lastOpenedAtMs: null }, OPENED_30)).toBe(false)
    expect(match({}, OPENED_30)).toBe(false)
  })

  /*
   * A click is not an open, and the rule language keeps them apart on
   * purpose: an open is partly a statement about a mail client that prefetches
   * images, and a merchant who asked for clickers must not be given openers.
   */
  it('does not accept a click as an open', () => {
    expect(
      match(
        { lastOpenedAtMs: null, lastClickedAtMs: NOW - DAY },
        OPENED_30,
      ),
    ).toBe(false)
    expect(
      match({ lastClickedAtMs: NOW - DAY }, {
        sources: ['contacts'],
        engagement: { clickedWithinDays: 30 },
      }),
    ).toBe(true)
  })

  /*
   * ⚠️ The opposite lean from `noPurchaseForDays`, and the one asserted so it
   * cannot be "tidied" into consistency. A purchase is an act the person
   * performed, so no record means they did not buy. An open is only visible
   * if we mailed them and their client loaded a pixel, so no record and no
   * open rest on the same evidence — and a merchant asking for the people who
   * are not engaging means the silent ones.
   */
  it('counts somebody with no record at all as not having opened', () => {
    const quiet = {
      sources: ['contacts'],
      engagement: { notOpenedForDays: 90 },
    }
    expect(match({ lastOpenedAtMs: null }, quiet)).toBe(true)
    expect(match({ lastOpenedAtMs: NOW - 200 * DAY }, quiet)).toBe(true)
    expect(match({ lastOpenedAtMs: NOW - 10 * DAY }, quiet)).toBe(false)
  })

  it('never lets the two arms of one window match the same person', () => {
    const person = { lastOpenedAtMs: NOW - 45 * DAY }
    const inside = match(person, {
      sources: ['contacts'],
      engagement: { openedWithinDays: 90 },
    })
    const outside = match(person, {
      sources: ['contacts'],
      engagement: { notOpenedForDays: 90 },
    })
    expect([inside, outside]).toEqual([true, false])
  })

  /*
   * Engagement is a fact about an ADDRESS. Restricting it to contacts — the
   * way `behavior` is restricted, because contacts are the only silo storing
   * RFM — would be restricting it to the silo that happens to hold the OTHER
   * figures, which is not a fact about engagement.
   */
  it('applies to every silo, not only contacts', () => {
    const rule = {
      sources: ['leads', 'siteMembers'],
      engagement: { openedWithinDays: 30 },
    }
    expect(match({ silo: 'leads', lastOpenedAtMs: NOW - DAY }, rule)).toBe(true)
    expect(match({ silo: 'leads', lastOpenedAtMs: null }, rule)).toBe(false)
  })
})

describe('membership of another audience', () => {
  it('excludes people already on a named list', () => {
    const rule = { sources: ['contacts'], notInListIds: ['customers'] }
    expect(match({ listIds: ['customers'] }, rule)).toBe(false)
    expect(match({ listIds: ['leads'] }, rule)).toBe(true)
    expect(match({ listIds: [] }, rule)).toBe(true)
  })

  it('requires membership of EVERY list named on the positive arm', () => {
    const rule = { sources: ['contacts'], inListIds: ['a', 'b'] }
    expect(match({ listIds: ['a', 'b'] }, rule)).toBe(true)
    expect(match({ listIds: ['a'] }, rule)).toBe(false)
  })

  /*
   * An un-enriched candidate reads as a member of nothing. The direction is
   * chosen, not defaulted: failing `inListIds` keeps somebody OUT, where
   * passing `notInListIds` would let a lookup failure quietly re-admit the
   * people a merchant excluded.
   */
  it('reads a candidate that was never enriched as on no list', () => {
    expect(match({}, { sources: ['contacts'], inListIds: ['a'] })).toBe(false)
    expect(match({}, { sources: ['contacts'], notInListIds: ['a'] })).toBe(true)
  })
})

/*==========================================
 * OR AND NEGATION.
 *
 * The operators the register lists as absent while every rival has them. The
 * property that makes them safe for the materializer is the one asserted
 * first: `sources` sits OUTSIDE both, so neither can change which collections
 * the sweep pages or in what order.
 *=========================================*/

describe('OR branches and negation', () => {
  /**
   * ⚠️ Written so a source check moved INSIDE the negation actually fails.
   *
   * The dimension is one the lead genuinely does not satisfy — no creation
   * stamp — so the negated block reads TRUE for it. Only the source filter
   * standing outside the operator keeps the lead out, which is the property
   * the materializer's scan plan, budget and resume cursor all rest on. A
   * fixture whose lead failed the block for some other reason would pass
   * either way and assert nothing.
   */
  it('leaves the source filter outside both operators', () => {
    const rule = {
      sources: ['contacts'],
      negate: true,
      createdAfterMs: NOW - 7 * DAY,
    }
    expect(match({ silo: 'leads', createdAtMs: null }, rule)).toBe(false)
    // The same rule against the silo it names: the negation works, so the
    // assertion above is about the source filter and not about a dead rule.
    expect(match({ silo: 'contacts', createdAtMs: null }, rule)).toBe(true)
  })

  it('matches when at least one branch matches', () => {
    const rule = {
      sources: ['contacts'],
      any: [
        { behavior: { ordersCountAtLeast: 3 } },
        { behavior: { ltvCentsAtLeast: 50_000 } },
      ],
    }
    expect(match({ ordersCount: 4, ltvCents: 0 }, rule)).toBe(true)
    expect(match({ ordersCount: 0, ltvCents: 60_000 }, rule)).toBe(true)
    expect(match({ ordersCount: 0, ltvCents: 100 }, rule)).toBe(false)
  })

  it('ANDs the top-level block with the branches', () => {
    const rule = {
      sources: ['contacts'],
      tags: ['vip'],
      any: [{ behavior: { ordersCountAtLeast: 3 } }, { tags: ['wholesale'] }],
    }
    expect(match({ tags: ['vip'], ordersCount: 4 }, rule)).toBe(true)
    // Satisfies a branch and fails the top block.
    expect(match({ tags: ['regular'], ordersCount: 4 }, rule)).toBe(false)
    // Satisfies the top block and no branch.
    expect(match({ tags: ['vip'], ordersCount: 0 }, rule)).toBe(false)
  })

  /*
   * `Array.prototype.some` on an empty array is FALSE, so a rule with no
   * branches would select nobody if the operator were applied unconditionally
   * — which is every rule written before this operator existed.
   */
  it('treats an absent or empty branch list as no constraint', () => {
    expect(match({ tags: ['vip'] }, { sources: ['contacts'], tags: ['vip'] })).toBe(
      true,
    )
    expect(
      match({ tags: ['vip'] }, { sources: ['contacts'], tags: ['vip'], any: [] }),
    ).toBe(true)
  })

  it('inverts the top-level block when negated', () => {
    const rule = { sources: ['contacts'], negate: true, tags: ['vip'] }
    expect(match({ tags: ['vip'] }, rule)).toBe(false)
    expect(match({ tags: ['regular'] }, rule)).toBe(true)
  })

  it('inverts a branch of its own, without touching its siblings', () => {
    const rule = {
      sources: ['contacts'],
      any: [{ negate: true, tags: ['blocked'] }, { tags: ['vip'] }],
    }
    // Not blocked, so the negated branch matches.
    expect(match({ tags: ['regular'] }, rule)).toBe(true)
    // Blocked, but VIP, so the second branch carries it.
    expect(match({ tags: ['blocked', 'vip'] }, rule)).toBe(true)
    expect(match({ tags: ['blocked'] }, rule)).toBe(false)
  })

  it('applies the saved segment to the rule, not to each branch', () => {
    const rule = { sources: ['contacts'], any: [{ tags: ['vip'] }] }
    const segment = { tags: ['member'] }
    // The segment is the rule's, so it applies to everybody.
    expect(match({ tags: ['vip', 'member'] }, rule, segment)).toBe(true)
    expect(match({ tags: ['vip'] }, rule, segment)).toBe(false)
  })

  /**
   * ⚠️ The assertion that can actually SEE the segment leaking into a branch.
   *
   * On a plain branch, folding the segment in changes nothing — the top-level
   * block already required it, so the extra condition is always satisfied. It
   * is only visible through a NEGATED branch, where the fold turns
   * `not(blocked)` into `not(blocked or member)` and excludes exactly the
   * people the segment was there to include.
   */
  it('does not fold the saved segment into a negated branch', () => {
    const rule = {
      sources: ['contacts'],
      any: [{ negate: true, tags: ['blocked'] }],
    }
    const segment = { tags: ['member'] }
    expect(match({ tags: ['member'] }, rule, segment)).toBe(true)
    // And the branch itself still works: a blocked member is excluded.
    expect(match({ tags: ['member', 'blocked'] }, rule, segment)).toBe(false)
  })

  /*
   * A branch with no filters matches everybody, and one satisfied branch
   * satisfies the whole disjunction — so keeping an empty one would silently
   * disable every branch beside it.
   */
  it('drops an empty branch rather than letting it swallow the others', () => {
    const rule = normalizeDynamicListRule({
      sources: ['contacts'],
      any: [{}, { tags: ['vip'] }],
    })
    expect(rule.any).toEqual([{ tags: ['vip'] }])
    expect(match({ tags: ['regular'] }, rule)).toBe(false)
  })

  it('drops a branch the coercion emptied of everything but its flag', () => {
    const rule = normalizeDynamicListRule({
      sources: ['contacts'],
      any: [{ negate: true }, { tags: ['vip'] }],
    })
    expect(rule.any).toEqual([{ tags: ['vip'] }])
  })
})

describe('a rule may not refer to the audience it fills', () => {
  it('strips the self-reference from both arms and every branch', () => {
    const stripped = dynamicListRuleWithoutListReference(
      normalizeDynamicListRule({
        sources: ['contacts'],
        notInListIds: ['self', 'customers'],
        any: [{ inListIds: ['self'] }, { tags: ['vip'] }],
      }),
      'self',
    )
    expect(stripped.notInListIds).toEqual(['customers'])
    // The branch whose only filter was the self-reference is dropped, not
    // kept empty: an empty branch matches everybody and would disable the
    // branch beside it.
    expect(stripped.any).toEqual([{ tags: ['vip'] }])
  })

  it('leaves a rule that names no list alone', () => {
    const rule = normalizeDynamicListRule({
      sources: ['contacts'],
      tags: ['vip'],
    })
    expect(dynamicListRuleWithoutListReference(rule, 'self')).toEqual(rule)
  })

  it('removes the `any` key entirely when nothing survives', () => {
    const stripped = dynamicListRuleWithoutListReference(
      normalizeDynamicListRule({
        sources: ['contacts'],
        any: [{ notInListIds: ['self'] }],
      }),
      'self',
    )
    expect(stripped).not.toHaveProperty('any')
  })
})

describe('what a rule makes the materializer pay for', () => {
  it('reports no engagement lookup for a rule that asks for none', () => {
    expect(
      dynamicListRuleNeedsEngagement(
        normalizeDynamicListRule({ sources: ['contacts'], tags: ['vip'] }),
      ),
    ).toBe(false)
  })

  it('reports one for a rule whose only engagement clause is in a branch', () => {
    expect(
      dynamicListRuleNeedsEngagement(
        normalizeDynamicListRule({
          sources: ['contacts'],
          any: [{ engagement: { openedWithinDays: 30 } }],
        }),
      ),
    ).toBe(true)
  })

  it('collects every list id a rule names, wherever it names it', () => {
    expect(
      dynamicListRuleListIds(
        normalizeDynamicListRule({
          sources: ['contacts'],
          notInListIds: ['a'],
          any: [{ inListIds: ['b'] }, { notInListIds: ['a', 'c'] }],
        }),
      ).sort(),
    ).toEqual(['a', 'b', 'c'])
  })
})
