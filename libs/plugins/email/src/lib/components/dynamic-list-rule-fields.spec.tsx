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
 * EVERY FIELD OF THE RULE SURVIVES A ROUND TRIP.
 *
 * The defect this holds the line on is not a crash. `DynamicListRule` carries
 * nine fields; the console wrote four. The matcher evaluated all nine, the
 * materializer ran them and the Firestore index was deployed — so the missing
 * five were not broken, they were UNREACHABLE, and a rule that reached them
 * some other way would be silently rewritten to four the next time anybody
 * opened the editor.
 *
 * So the assertion is the round trip: a rule using every dimension, turned
 * into what the controls show and back, has to come out the same rule. A
 * conversion that drops a field passes every rendering test ever written and
 * fails this one.
 */

import {
  describeDynamicListRule,
  draftToRule,
  ruleToDraft,
  EMPTY_RULE_DRAFT,
  type DynamicListRuleDraft,
} from './dynamic-list-rule-fields'
import {
  DYNAMIC_LIST_MAX_CUSTOM_CLAUSES,
  DYNAMIC_LIST_MAX_GROUPS,
  type DynamicListRule,
} from '@aglyn/aglyn'

/** A rule that sets every dimension the model has. */
const FULL_RULE: DynamicListRule = {
  sources: ['contacts', 'formSubmissions'],
  segmentId: 'seg_1',
  viewId: 'view_1',
  tags: ['vip', 'wholesale'],
  captureSources: ['form', 'order'],
  formNames: ['Contact us'],
  campaignIds: ['camp_spring'],
  createdAfterMs: Date.parse('2026-01-01'),
  createdBeforeMs: Date.parse('2026-06-30'),
  behavior: {
    ordersCountAtLeast: 2,
    ltvCentsAtLeast: 50_000,
    lastPurchaseWithinDays: 90,
    noPurchaseForDays: 30,
  },
  engagement: {
    openedWithinDays: 30,
    clickedWithinDays: 60,
    notOpenedForDays: 90,
    notClickedForDays: 120,
  },
  inListIds: ['list_a'],
  notInListIds: ['list_b'],
  ownerUids: ['uid-a'],
  lifecycleStages: ['lead', 'customer'],
  companyIds: ['co_acme'],
  custom: [
    { key: 'plan', op: 'eq', value: 'enterprise' },
    { key: 'seats', op: 'gt', value: 10 },
    { key: 'churned', op: 'unset' },
  ],
}

/** Every dimension, named so a dropped one is reported BY NAME. */
const RULE_FIELDS = [
  'sources',
  'segmentId',
  'viewId',
  'tags',
  'captureSources',
  'formNames',
  'campaignIds',
  'createdAfterMs',
  'createdBeforeMs',
  'behavior',
  'engagement',
  'inListIds',
  'notInListIds',
  'ownerUids',
  'lifecycleStages',
  'companyIds',
  'custom',
] as const

const BEHAVIOR_FIELDS = [
  'ordersCountAtLeast',
  'ltvCentsAtLeast',
  'lastPurchaseWithinDays',
  'noPurchaseForDays',
] as const

const ENGAGEMENT_FIELDS = [
  'openedWithinDays',
  'clickedWithinDays',
  'notOpenedForDays',
  'notClickedForDays',
] as const

describe('the rule editor reaches every field of the rule', () => {
  it('THE CONTROL: the fixture really does set every one', () => {
    // Guard the guard. A fixture that had lost a field would make every
    // round-trip assertion below pass by never testing it.
    for (const field of RULE_FIELDS) {
      expect(FULL_RULE[field]).toBeDefined()
    }
    for (const field of BEHAVIOR_FIELDS) {
      expect(FULL_RULE.behavior?.[field]).toBeDefined()
    }
    for (const field of ENGAGEMENT_FIELDS) {
      expect(FULL_RULE.engagement?.[field]).toBeDefined()
    }
    expect(RULE_FIELDS).toHaveLength(17)
    expect(BEHAVIOR_FIELDS).toHaveLength(4)
    expect(ENGAGEMENT_FIELDS).toHaveLength(4)
  })

  it('a rule survives being shown and read back', () => {
    expect(draftToRule(ruleToDraft(FULL_RULE))).toEqual(FULL_RULE)
  })

  it.each(RULE_FIELDS)('keeps %s', (field) => {
    // Per-field so a regression names the dimension it lost rather than
    // reporting one opaque object mismatch.
    expect(draftToRule(ruleToDraft(FULL_RULE))[field]).toEqual(
      FULL_RULE[field],
    )
  })

  it.each(BEHAVIOR_FIELDS)('keeps behavior.%s', (field) => {
    expect(draftToRule(ruleToDraft(FULL_RULE)).behavior?.[field]).toBe(
      FULL_RULE.behavior?.[field],
    )
  })

  it.each(ENGAGEMENT_FIELDS)('keeps engagement.%s', (field) => {
    expect(draftToRule(ruleToDraft(FULL_RULE)).engagement?.[field]).toBe(
      FULL_RULE.engagement?.[field],
    )
  })
})

describe('money is entered the way a merchant says it', () => {
  it('shows cents as whole units and stores whole units as cents', () => {
    // The failure this prevents: a field labeled for the STORED unit turns
    // "customers who spent over 500" into customers who spent over five
    // dollars, and the resulting audience looks entirely plausible.
    expect(ruleToDraft(FULL_RULE).ltvAtLeast).toBe('500')
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, ltvAtLeast: '500' }).behavior
        ?.ltvCentsAtLeast,
    ).toBe(50_000)
  })

  it('rounds to a whole cent', () => {
    // A half-cent threshold is not a quantity any order total can be
    // compared against.
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, ltvAtLeast: '19.995' }).behavior
        ?.ltvCentsAtLeast,
    ).toBe(2000)
  })
})

describe('an empty box is not a filter', () => {
  /*
   * `Number('')` is `0`, so a conversion that read every box would turn an
   * untouched form into four active filters. `noPurchaseForDays: 0` matches
   * nobody, which means the merchant would save a rule that empties the
   * audience without having typed anything.
   */
  it.each(BEHAVIOR_FIELDS)('leaves %s unset when its box is blank', (field) => {
    expect(draftToRule(EMPTY_RULE_DRAFT).behavior?.[field]).toBeUndefined()
  })

  it('writes no behavior block at all when none of them is set', () => {
    expect(draftToRule(EMPTY_RULE_DRAFT).behavior).toBeUndefined()
  })

  it('THE CONTROL: a typed zero IS a filter', () => {
    // Otherwise the rule above is indistinguishable from "numbers are
    // ignored", and a merchant who really did type 0 would be overruled.
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, ordersCountAtLeast: '0' }).behavior
        ?.ordersCountAtLeast,
    ).toBe(0)
  })

  it('leaves both date boundaries unset when their boxes are blank', () => {
    const rule = draftToRule(EMPTY_RULE_DRAFT)
    expect(rule.createdAfterMs).toBeUndefined()
    expect(rule.createdBeforeMs).toBeUndefined()
  })
})

describe('a date boundary does not walk backwards on every edit', () => {
  /*
   * `Date.parse('2026-01-01')` is UTC midnight. Reading it back through the
   * LOCAL calendar would move the boundary by the reader's offset, so a rule
   * saved west of Greenwich would reopen naming the previous day — and saving
   * again would move it again, once per edit, forever.
   */
  it('round-trips the same day it was given', () => {
    const draft: DynamicListRuleDraft = {
      ...EMPTY_RULE_DRAFT,
      createdAfter: '2026-01-01',
      createdBefore: '2026-06-30',
    }
    const reopened = ruleToDraft(draftToRule(draft))
    expect(reopened.createdAfter).toBe('2026-01-01')
    expect(reopened.createdBefore).toBe('2026-06-30')
  })

  it('is stable over repeated edits', () => {
    let draft: DynamicListRuleDraft = {
      ...EMPTY_RULE_DRAFT,
      createdAfter: '2026-03-15',
    }
    for (let round = 0; round < 5; round += 1) {
      draft = ruleToDraft(draftToRule(draft))
    }
    expect(draft.createdAfter).toBe('2026-03-15')
  })
})

describe('free text becomes a list, and blanks are not entries', () => {
  it('splits, trims and drops the empties', () => {
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, tags: ' vip , , wholesale ' }).tags,
    ).toEqual(['vip', 'wholesale'])
  })

  it('writes no key at all when the box holds only separators', () => {
    // An empty array is not the same stored rule as an absent field, and
    // `contactMatchesSegment` reads the two differently.
    expect(draftToRule({ ...EMPTY_RULE_DRAFT, tags: ' , , ' }).tags)
      .toBeUndefined()
  })
})

/*==========================================
 * THE COMBINATOR.
 *
 * `all`, `any` and `none` are the three shapes this form authors on top of
 * the rule's two operators. The assertions worth having are the ones about
 * the SHAPE it produces, because that is what the sweep evaluates — a form
 * that showed "any" and stored an AND would be wrong in the one place nobody
 * looks.
 *=========================================*/

describe('all, any and none', () => {
  const TWO_FILTERS: DynamicListRuleDraft = {
    ...EMPTY_RULE_DRAFT,
    tags: 'vip',
    ordersCountAtLeast: '3',
  }

  it('ANDs the filters by default, with no operator written at all', () => {
    const rule = draftToRule(TWO_FILTERS)
    expect(rule).toMatchObject({
      tags: ['vip'],
      behavior: { ordersCountAtLeast: 3 },
    })
    expect(rule.any).toBeUndefined()
    expect(rule.negate).toBeUndefined()
  })

  it('gives each filter its own branch in any mode', () => {
    const rule = draftToRule({ ...TWO_FILTERS, match: 'any' })
    expect(rule.any).toEqual([
      { tags: ['vip'] },
      { behavior: { ordersCountAtLeast: 3 } },
    ])
    // And nothing is left at the top to be ANDed with them.
    expect(rule.tags).toBeUndefined()
    expect(rule.behavior).toBeUndefined()
  })

  /*
   * Per CONTROL rather than per block. A reader who typed into four purchase
   * boxes and chose "any one of these" means any one of the four, not a
   * branch that requires all four together.
   */
  it('splits the purchase block into a branch per figure', () => {
    const rule = draftToRule({
      ...EMPTY_RULE_DRAFT,
      match: 'any',
      ordersCountAtLeast: '3',
      ltvAtLeast: '500',
    })
    expect(rule.any).toEqual([
      { behavior: { ordersCountAtLeast: 3 } },
      { behavior: { ltvCentsAtLeast: 50_000 } },
    ])
  })

  it('merges the leaves back into one block for all and none', () => {
    // The mirror of the split above: a shallow merge would keep only the last
    // leaf of `behavior` and silently drop the other three.
    expect(
      draftToRule({
        ...EMPTY_RULE_DRAFT,
        ordersCountAtLeast: '3',
        ltvAtLeast: '500',
        openedWithinDays: '30',
        notClickedForDays: '90',
      }),
    ).toMatchObject({
      behavior: { ordersCountAtLeast: 3, ltvCentsAtLeast: 50_000 },
      engagement: { openedWithinDays: 30, notClickedForDays: 90 },
    })
  })

  it('inverts the block in none mode', () => {
    expect(draftToRule({ ...TWO_FILTERS, match: 'none' })).toMatchObject({
      negate: true,
      tags: ['vip'],
    })
  })

  /*
   * "Exclude everyone matching nothing" excludes everyone. The flag is
   * written only when there is something to invert, so an untouched form left
   * in `none` selects the sources rather than emptying them.
   */
  it('writes no negation when there is nothing to invert', () => {
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, match: 'none' }).negate,
    ).toBeUndefined()
  })

  it.each(['all', 'any', 'none'] as const)('round-trips %s mode', (match) => {
    expect(ruleToDraft(draftToRule({ ...TWO_FILTERS, match })).match).toBe(match)
  })

  /*
   * The form's "any" mode puts each control in a branch of its own, so a
   * reader who fills in every box authors more branches than most rules will
   * ever have — and dropping a branch NARROWS an OR. The model's cap has to
   * sit above what the form can reach or the sentences on screen would
   * describe a wider audience than the rule selects.
   */
  it('never authors more branches than the model will keep', () => {
    const everything: DynamicListRuleDraft = {
      ...EMPTY_RULE_DRAFT,
      match: 'any',
      tags: 'vip',
      captureSources: ['form'],
      formNames: 'Contact us',
      campaignIds: ['camp_spring'],
      createdAfter: '2026-01-01',
      createdBefore: '2026-06-30',
      ordersCountAtLeast: '3',
      ltvAtLeast: '500',
      lastPurchaseWithinDays: '90',
      noPurchaseForDays: '30',
      openedWithinDays: '30',
      clickedWithinDays: '60',
      notOpenedForDays: '90',
      notClickedForDays: '120',
      inListIds: ['a'],
      notInListIds: ['b'],
      ownerUids: ['uid-a'],
      lifecycleStages: ['lead'],
      companyIds: ['co_acme'],
      custom: [{ key: 'plan', op: 'eq', value: 'enterprise' }],
    }
    expect(draftToRule(everything).any).toHaveLength(20)
  })

  /*
   * The custom-field rows are the one control a reader can add MANY of, and
   * each one is its own branch in any mode. The model's cap has to hold the
   * fixed controls plus every clause the model itself will keep — or a form
   * filled to the model's own limit would author branches the normalizer
   * drops, narrowing the OR the sentences above the controls describe.
   */
  it('keeps every custom clause as a branch, up to the model’s own cap', () => {
    const clauses = Array.from({ length: DYNAMIC_LIST_MAX_CUSTOM_CLAUSES }, (_, i) => ({
      key: `field_${i}`,
      op: 'set' as const,
    }))
    const rule = draftToRule({
      ...EMPTY_RULE_DRAFT,
      match: 'any',
      tags: 'vip',
      captureSources: ['form'],
      formNames: 'Contact us',
      campaignIds: ['camp_spring'],
      createdAfter: '2026-01-01',
      createdBefore: '2026-06-30',
      ordersCountAtLeast: '3',
      ltvAtLeast: '500',
      lastPurchaseWithinDays: '90',
      noPurchaseForDays: '30',
      openedWithinDays: '30',
      clickedWithinDays: '60',
      notOpenedForDays: '90',
      notClickedForDays: '120',
      inListIds: ['a'],
      notInListIds: ['b'],
      ownerUids: ['uid-a'],
      lifecycleStages: ['lead'],
      companyIds: ['co_acme'],
      custom: clauses,
    })
    expect(rule.any).toHaveLength(19 + DYNAMIC_LIST_MAX_CUSTOM_CLAUSES)
    expect(19 + DYNAMIC_LIST_MAX_CUSTOM_CLAUSES).toBeLessThanOrEqual(
      DYNAMIC_LIST_MAX_GROUPS,
    )
  })
})

/*==========================================
 * THE CRM DIMENSIONS IN THE FORM (AGL-2603).
 *
 * Owner, lifecycle stage, company and custom field reach the draft, come
 * back out of it unchanged, split per control in any mode, and read back as
 * sentences that name a person, a stage and a company rather than an id —
 * and that say, for the one operator whose lean is not obvious, what a blank
 * value does.
 *=========================================*/
describe('the CRM dimensions in the form', () => {
  it('gives each custom clause a branch of its own in any mode', () => {
    expect(
      draftToRule({
        ...EMPTY_RULE_DRAFT,
        match: 'any',
        custom: [
          { key: 'plan', op: 'eq', value: 'enterprise' },
          { key: 'seats', op: 'gt', value: 10 },
        ],
      }).any,
    ).toEqual([
      { custom: [{ key: 'plan', op: 'eq', value: 'enterprise' }] },
      { custom: [{ key: 'seats', op: 'gt', value: 10 }] },
    ])
  })

  it('keeps every custom clause in one block for all mode', () => {
    // The mirror of the split: a merge that kept only the last clause would
    // silently drop the rest, the way a shallow `behavior` merge would.
    expect(
      draftToRule({
        ...EMPTY_RULE_DRAFT,
        custom: [
          { key: 'plan', op: 'eq', value: 'enterprise' },
          { key: 'seats', op: 'gt', value: 10 },
        ],
      }).custom,
    ).toEqual([
      { key: 'plan', op: 'eq', value: 'enterprise' },
      { key: 'seats', op: 'gt', value: 10 },
    ])
  })

  it('leaves an unfinished row out of the rule until it is filled', () => {
    // A row the reader has added but not completed is not a filter yet; a
    // rule that carried it would be one the matcher can never satisfy.
    const rule = draftToRule({
      ...EMPTY_RULE_DRAFT,
      custom: [{ key: 'plan', op: 'eq', value: '' }],
    })
    expect(rule.custom).toBeUndefined()
  })

  it('writes no key at all when none of them is set', () => {
    const rule = draftToRule(EMPTY_RULE_DRAFT)
    expect(rule.ownerUids).toBeUndefined()
    expect(rule.lifecycleStages).toBeUndefined()
    expect(rule.companyIds).toBeUndefined()
    expect(rule.custom).toBeUndefined()
  })

  describe('read back as sentences', () => {
    const NAMES = {
      members: { 'uid-a': 'Ada Lovelace' },
      companies: { co_acme: 'Acme' },
      fields: { plan: 'Plan', seats: 'Seats' },
    }
    const sentence = (dimensions: Record<string, unknown>) =>
      describeDynamicListRule(
        { sources: ['contacts'], ...dimensions } as never,
        NAMES,
      ).join(' ')

    it('names a team member rather than printing a uid', () => {
      expect(sentence({ ownerUids: ['uid-a'] })).toContain('Owned by: Ada Lovelace')
      expect(sentence({ ownerUids: ['uid-zz'] })).toContain('Owned by: uid-zz')
    })

    it('names the stages as a person reads them', () => {
      expect(sentence({ lifecycleStages: ['marketing-qualified', 'customer'] })).toContain(
        'In stage: Marketing qualified, Customer',
      )
    })

    it('names a company rather than printing its id', () => {
      expect(sentence({ companyIds: ['co_acme'] })).toContain('At company: Acme')
    })

    it('reads each custom operator, with the field’s label', () => {
      expect(sentence({ custom: [{ key: 'plan', op: 'eq', value: 'enterprise' }] })).toContain(
        'Plan is enterprise',
      )
      expect(sentence({ custom: [{ key: 'seats', op: 'gt', value: 10 }] })).toContain(
        'Seats is more than 10',
      )
      expect(sentence({ custom: [{ key: 'seats', op: 'lt', value: 10 }] })).toContain(
        'Seats is less than 10',
      )
      expect(sentence({ custom: [{ key: 'plan', op: 'contains', value: 'ent' }] })).toContain(
        'Plan contains ent',
      )
      expect(sentence({ custom: [{ key: 'plan', op: 'set' }] })).toContain('Plan is set')
      expect(sentence({ custom: [{ key: 'plan', op: 'unset' }] })).toContain(
        'Plan is not set',
      )
      // A key with no definition on hand is still named, as itself.
      expect(sentence({ custom: [{ key: 'region', op: 'set' }] })).toContain('region is set')
    })

    it('says that a blank does not count as "is not"', () => {
      // The one lean a reader cannot guess: excluding one plan does not
      // select everyone whose plan was never recorded.
      expect(sentence({ custom: [{ key: 'plan', op: 'neq', value: 'enterprise' }] })).toContain(
        'Plan is not enterprise (a blank does not count)',
      )
    })
  })
})

describe('the rule reads back as sentences', () => {
  const clauses = (rule: Parameters<typeof describeDynamicListRule>[0]) =>
    describeDynamicListRule(rule).join(' ')

  it('says which lean each engagement arm takes', () => {
    // The reason it is spelled out: `notOpenedForDays` counts somebody with
    // no record, and `noPurchaseForDays` beside it does not. A reader
    // checking a paragraph against their intent cannot be expected to
    // remember which dimension leans which way.
    expect(
      clauses({ sources: ['contacts'], engagement: { notOpenedForDays: 90 } }),
    ).toContain('or never opened anything')
    expect(
      clauses({ sources: ['contacts'], behavior: { noPurchaseForDays: 90 } }),
    ).toContain('Has bought nothing for 90 days')
  })

  it('names an audience rather than printing its id', () => {
    expect(
      describeDynamicListRule(
        { sources: ['contacts'], notInListIds: ['list_a'] },
        { lists: { list_a: 'Customers' } },
      ).join(' '),
    ).toContain('Not on: Customers')
  })

  /*
   * ONE clause for the whole disjunction. "At least one of" printed per
   * branch would read as a separate requirement per branch, which is the AND
   * this operator exists to escape.
   */
  it('reads the branches as a single disjunction, not one demand each', () => {
    const sentence = clauses({
      sources: ['contacts'],
      any: [{ tags: ['vip'] }, { behavior: { ordersCountAtLeast: 3 } }],
    })
    expect(sentence).toContain('And at least one of these:')
    expect(sentence).toContain('; or ')
    expect(sentence.match(/at least one of these/g)).toHaveLength(1)
  })

  /*
   * And ONE clause for a negated block. "Excludes anyone tagged vip.
   * Excludes anyone who spent over 500." reads as two independent
   * exclusions; the rule excludes people who are BOTH.
   */
  it('reads a negated block as one exclusion rather than several', () => {
    const sentence = clauses({
      sources: ['contacts'],
      negate: true,
      tags: ['vip'],
      behavior: { ordersCountAtLeast: 3 },
    })
    expect(sentence).toContain('Excludes anyone matching all of:')
    expect(sentence.match(/Excludes anyone/g)).toHaveLength(1)
  })

  it('names a campaign rather than printing its id', () => {
    expect(
      describeDynamicListRule(
        { sources: ['contacts'], campaignIds: ['camp_spring'] },
        { campaigns: { camp_spring: 'Spring push' } },
      ).join(' '),
    ).toContain('Spring push')
  })

  /*
   * The sentence has to say which silos the filter applies to. A lead and a
   * site member carry no campaign, and the matcher SKIPS the dimension for
   * them rather than failing it — so a reader who was not told would conclude
   * that a rule drawing from leads and naming a campaign selects no leads,
   * which is the opposite of what it does.
   */
  it('says which silos a campaign filter applies to', () => {
    expect(
      clauses({
        sources: ['contacts', 'leads'],
        campaignIds: ['camp_spring'],
      }),
    ).toContain('contacts and form submissions only')
  })
})

/*==========================================
 * THE CAMPAIGN DIMENSION.
 *
 * The picker stores ids and the sentences render names, which is the same
 * split every other id-valued control here takes. What is worth asserting is
 * that a filter reachable from the form is a filter the engine reads: a
 * campaign chosen on screen and dropped by `draftToRule` would build an
 * audience of the whole site with nothing on screen to say so.
 *=========================================*/

describe('an audience built from a campaign', () => {
  it('stores the ids the picker chose', () => {
    expect(
      draftToRule({ ...EMPTY_RULE_DRAFT, campaignIds: ['camp_a', 'camp_b'] })
        .campaignIds,
    ).toEqual(['camp_a', 'camp_b'])
  })

  it('writes no key at all when no campaign is picked', () => {
    // An empty array is not the same stored rule as an absent field: the
    // matcher reads a present-but-empty list as no constraint, and a writer
    // that stored one would leave a rule reading as a campaign filter that
    // filters nothing.
    expect(draftToRule(EMPTY_RULE_DRAFT).campaignIds).toBeUndefined()
  })

  it('reopens with the campaigns it was saved with', () => {
    expect(
      ruleToDraft(
        draftToRule({ ...EMPTY_RULE_DRAFT, campaignIds: ['camp_a'] }),
      ).campaignIds,
    ).toEqual(['camp_a'])
  })

  it('gets a branch of its own in any mode', () => {
    expect(
      draftToRule({
        ...EMPTY_RULE_DRAFT,
        match: 'any',
        campaignIds: ['camp_a'],
        tags: 'vip',
      }).any,
    ).toEqual([{ tags: ['vip'] }, { campaignIds: ['camp_a'] }])
  })
})
