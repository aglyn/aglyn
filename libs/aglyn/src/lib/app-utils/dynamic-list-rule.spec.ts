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
  dynamicListRuleNeedsCampaigns,
  dynamicListRuleNeedsEngagement,
  dynamicListRuleNeedsContactFacet,
  dynamicListRuleWithoutListReference,
  customValueMatches,
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

/*==========================================
 * AN AUDIENCE BUILT FROM A CAMPAIGN.
 *
 * A merchant files three forms under the spring push and wants the people who
 * came in through them. Two silos can answer: a contact carries the holder's
 * filing, a submission carries the filing its form had when it arrived. The
 * other two carry none, and the discipline that keeps them from being silently
 * emptied is the same skip rule every other silo-specific dimension follows.
 *=========================================*/

describe('the campaign dimension', () => {
  const SPRING = { sources: ['contacts'], campaignIds: ['camp_spring'] }

  it('matches a contact filed under the campaign', () => {
    expect(match({ campaignIds: ['camp_spring'] }, SPRING)).toBe(true)
  })

  it('excludes a contact filed under some other campaign', () => {
    expect(match({ campaignIds: ['camp_summer'] }, SPRING)).toBe(false)
  })

  /** An absent field is a record nobody filed, not a record that matches. */
  it('excludes a record with no membership at all', () => {
    expect(match({}, SPRING)).toBe(false)
  })

  /**
   * OR within the dimension. A merchant naming three campaigns means anyone
   * in any of them — an AND would select the handful of people filed under
   * all three at once, which is not what a list of campaigns reads as.
   */
  it('matches any one of the campaigns named', () => {
    expect(
      match(
        { campaignIds: ['camp_summer'] },
        { sources: ['contacts'], campaignIds: ['camp_spring', 'camp_summer'] },
      ),
    ).toBe(true)
  })

  it('matches a form submission on its own stamped membership', () => {
    expect(
      match(
        { silo: 'formSubmissions', campaignIds: ['camp_spring'] },
        { sources: ['formSubmissions'], campaignIds: ['camp_spring'] },
      ),
    ).toBe(true)
  })

  /**
   * ⚠️ THE SKIP RULE. A lead carries no campaign, so a rule of "people in the
   * spring push, and every lead" must still contribute leads. Failing the
   * dimension instead would make the second source silently contribute
   * nobody — the defect this rule language exists to avoid.
   */
  it('skips the dimension for a silo that carries no campaign', () => {
    expect(
      match(
        { silo: 'leads' },
        { sources: ['contacts', 'leads'], campaignIds: ['camp_spring'] },
      ),
    ).toBe(true)
    expect(
      match(
        { silo: 'siteMembers' },
        { sources: ['siteMembers'], campaignIds: ['camp_spring'] },
      ),
    ).toBe(true)
  })

  /**
   * The honest consequence of the skip above, asserted so it is a decision
   * rather than a surprise: a NEGATED branch whose only filter is a skipped
   * dimension excludes that silo entirely, because the branch matched
   * vacuously and the negation inverts it.
   */
  it('excludes a skipping silo from a negated branch', () => {
    expect(
      match(
        { silo: 'leads' },
        {
          sources: ['contacts', 'leads'],
          any: [{ campaignIds: ['camp_spring'], negate: true }],
        },
      ),
    ).toBe(false)
  })

  it('coerces the stored list through the campaign field’s own normalizer', () => {
    expect(
      normalizeDynamicListRule({
        sources: ['contacts'],
        campaignIds: [' camp_a ', 'camp_a', 7, '', 'camp_b'],
      }).campaignIds,
    ).toEqual(['camp_a', 'camp_b'])
  })

  it('keeps no empty key, so a blank picker is not a filter', () => {
    expect(
      normalizeDynamicListRule({ sources: ['contacts'], campaignIds: [] }),
    ).not.toHaveProperty('campaignIds')
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

  /*
   * The contact facet a campaign clause reads is keyed by a consent group,
   * and resolving that group is an org read. A rule that names no campaign
   * must not pay it — the same opt-in shape the engagement lookup takes.
   */
  it('reports no campaign lookup for a rule that asks for none', () => {
    expect(
      dynamicListRuleNeedsCampaigns(
        normalizeDynamicListRule({ sources: ['contacts'], tags: ['vip'] }),
      ),
    ).toBe(false)
  })

  it('reports one for a rule whose only campaign clause is in a branch', () => {
    expect(
      dynamicListRuleNeedsCampaigns(
        normalizeDynamicListRule({
          sources: ['contacts'],
          any: [{ campaignIds: ['camp_spring'] }],
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

/*==========================================
 * THE CRM DIMENSIONS (AGL-2603).
 *
 * An audience could be cut by tag, source and purchase history and by nothing
 * a sales team keeps: not the owner of the relationship, not where the person
 * sits in the funnel, not the company they work for, not a custom field. All
 * four live on the holder's facet beside the tags, so they are contacts-only
 * dimensions with the same skip rule the tags have — and the custom-field
 * operators carry their own lean on a blank value, which the sentences read
 * back and the assertions below pin.
 *=========================================*/
describe('who owns the relationship', () => {
  it('matches a contact owned by any of the named team members', () => {
    const rule = { sources: ['contacts'], ownerUids: ['uid-a', 'uid-b'] }
    expect(match({ ownerUid: 'uid-b' }, rule)).toBe(true)
    expect(match({ ownerUid: 'uid-c' }, rule)).toBe(false)
  })

  it('excludes a contact nobody owns', () => {
    expect(match({}, { sources: ['contacts'], ownerUids: ['uid-a'] })).toBe(
      false,
    )
  })

  it('is skipped for a silo that carries no owner', () => {
    expect(
      match(
        { silo: 'leads' },
        { sources: ['contacts', 'leads'], ownerUids: ['uid-a'] },
      ),
    ).toBe(true)
  })
})

describe('where the person sits in the funnel', () => {
  it('matches any of the named stages', () => {
    const rule = {
      sources: ['contacts'],
      lifecycleStages: ['lead', 'customer'],
    }
    expect(match({ lifecycleStage: 'customer' }, rule)).toBe(true)
    expect(match({ lifecycleStage: 'evangelist' }, rule)).toBe(false)
    expect(match({}, rule)).toBe(false)
  })

  it('drops a stage the model does not name rather than matching nobody', () => {
    // A typo'd stage that survived would be a filter no contact can satisfy;
    // dropped, the rule reads as the stages it does name.
    expect(
      normalizeDynamicListRule({
        sources: ['contacts'],
        lifecycleStages: ['lead', 'hot'],
      }),
    ).toMatchObject({ lifecycleStages: ['lead'] })
    expect(
      normalizeDynamicListRule({ sources: ['contacts'], lifecycleStages: ['hot'] })
        .lifecycleStages,
    ).toBeUndefined()
  })
})

describe('which company the person belongs to', () => {
  it('matches a contact at any of the named companies', () => {
    const rule = { sources: ['contacts'], companyIds: ['co-1', 'co-2'] }
    expect(match({ companyId: 'co-2' }, rule)).toBe(true)
    expect(match({ companyId: 'co-9' }, rule)).toBe(false)
    expect(match({}, rule)).toBe(false)
  })
})

describe('a custom field', () => {
  const custom = (key: string, op: string, value?: unknown) => ({
    sources: ['contacts'],
    custom: [{ key, op, ...(value === undefined ? {} : { value }) }],
  })

  it('is equal to, case-insensitively for text', () => {
    expect(
      match({ custom: { plan: 'Enterprise' } }, custom('plan', 'eq', 'enterprise')),
    ).toBe(true)
    expect(
      match({ custom: { plan: 'starter' } }, custom('plan', 'eq', 'enterprise')),
    ).toBe(false)
    expect(match({ custom: { seats: 10 } }, custom('seats', 'eq', 10))).toBe(true)
    expect(match({ custom: { vip: true } }, custom('vip', 'eq', true))).toBe(true)
  })

  /**
   * "Is not" requires a VALUE that differs. A blank does not count, because
   * a merchant excluding one plan is not asking for everyone whose plan was
   * never recorded — the `unset` operator is the way to ask for those.
   */
  it('is not equal to — a blank does not count', () => {
    expect(
      match({ custom: { plan: 'starter' } }, custom('plan', 'neq', 'enterprise')),
    ).toBe(true)
    expect(
      match({ custom: { plan: 'enterprise' } }, custom('plan', 'neq', 'enterprise')),
    ).toBe(false)
    expect(match({ custom: {} }, custom('plan', 'neq', 'enterprise'))).toBe(false)
    expect(
      match({ custom: { plan: null } }, custom('plan', 'neq', 'enterprise')),
    ).toBe(false)
  })

  it('contains, case-insensitively', () => {
    expect(
      match(
        { custom: { notes: 'Met at Expo 2026' } },
        custom('notes', 'contains', 'expo'),
      ),
    ).toBe(true)
    expect(
      match({ custom: { notes: 'Cold call' } }, custom('notes', 'contains', 'expo')),
    ).toBe(false)
    expect(match({}, custom('notes', 'contains', 'expo'))).toBe(false)
  })

  it('compares numbers as numbers, and everything else as text', () => {
    expect(match({ custom: { seats: 12 } }, custom('seats', 'gt', 10))).toBe(true)
    expect(match({ custom: { seats: 9 } }, custom('seats', 'gt', 10))).toBe(false)
    expect(match({ custom: { seats: '9' } }, custom('seats', 'lt', 10))).toBe(true)
    // ISO dates order as text, which is what a date field stores.
    expect(
      match(
        { custom: { renews: '2026-12-01' } },
        custom('renews', 'gt', '2026-06-30'),
      ),
    ).toBe(true)
    expect(match({}, custom('seats', 'gt', 10))).toBe(false)
  })

  it('is set, and is not set', () => {
    expect(match({ custom: { plan: 'starter' } }, custom('plan', 'set'))).toBe(true)
    expect(match({ custom: { plan: '' } }, custom('plan', 'set'))).toBe(false)
    expect(match({ custom: { plan: null } }, custom('plan', 'unset'))).toBe(true)
    expect(match({}, custom('plan', 'unset'))).toBe(true)
    expect(match({ custom: { plan: false } }, custom('plan', 'set'))).toBe(true)
  })

  it('ANDs several clauses, like every other dimension', () => {
    const rule = {
      sources: ['contacts'],
      custom: [
        { key: 'plan', op: 'eq', value: 'enterprise' },
        { key: 'seats', op: 'gt', value: 10 },
      ],
    }
    expect(match({ custom: { plan: 'enterprise', seats: 50 } }, rule)).toBe(true)
    expect(match({ custom: { plan: 'enterprise', seats: 5 } }, rule)).toBe(false)
  })

  it('drops a clause with a bad key, an unknown operator, or a missing value', () => {
    const rule = normalizeDynamicListRule({
      sources: ['contacts'],
      custom: [
        { key: 'Plan Name', op: 'eq', value: 'x' },
        { key: 'plan', op: 'between', value: 'x' },
        { key: 'plan', op: 'eq' },
        { key: 'plan', op: 'unset', value: 'ignored' },
        { key: 'plan', op: 'eq', value: { nested: true } },
      ],
    })
    expect(rule.custom).toEqual([
      // The key is normalized the way a definition's key is, so a clause
      // typed against the label still reaches the stored key.
      { key: 'plan_name', op: 'eq', value: 'x' },
      { key: 'plan', op: 'unset' },
    ])
  })

  it('exposes the comparison on its own, for a surface that previews a value', () => {
    expect(
      customValueMatches('Enterprise', { key: 'plan', op: 'eq', value: 'enterprise' }),
    ).toBe(true)
    expect(customValueMatches(undefined, { key: 'plan', op: 'unset' })).toBe(true)
  })
})

describe('what the CRM dimensions make the materializer pay for', () => {
  it('reports a facet read for a rule that names any of them, wherever it names it', () => {
    expect(
      dynamicListRuleNeedsContactFacet(
        normalizeDynamicListRule({ sources: ['contacts'], tags: ['vip'] }),
      ),
    ).toBe(false)
    for (const clause of [
      { ownerUids: ['uid-a'] },
      { lifecycleStages: ['lead'] },
      { companyIds: ['co-1'] },
      { custom: [{ key: 'plan', op: 'set' }] },
      { campaignIds: ['camp_spring'] },
    ]) {
      expect(
        dynamicListRuleNeedsContactFacet(
          normalizeDynamicListRule({ sources: ['contacts'], any: [clause] }),
        ),
      ).toBe(true)
    }
  })
})
