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
  draftToRule,
  ruleToDraft,
  EMPTY_RULE_DRAFT,
  type DynamicListRuleDraft,
} from './dynamic-list-rule-fields'
import type { DynamicListRule } from '@aglyn/aglyn'

/** A rule that sets every dimension the model has. */
const FULL_RULE: DynamicListRule = {
  sources: ['contacts', 'formSubmissions'],
  segmentId: 'seg_1',
  tags: ['vip', 'wholesale'],
  captureSources: ['form', 'order'],
  formNames: ['Contact us'],
  createdAfterMs: Date.parse('2026-01-01'),
  createdBeforeMs: Date.parse('2026-06-30'),
  behavior: {
    ordersCountAtLeast: 2,
    ltvCentsAtLeast: 50_000,
    lastPurchaseWithinDays: 90,
    noPurchaseForDays: 30,
  },
}

/** The nine fields, named so a dropped one is reported BY NAME. */
const RULE_FIELDS = [
  'sources',
  'segmentId',
  'tags',
  'captureSources',
  'formNames',
  'createdAfterMs',
  'createdBeforeMs',
  'behavior',
] as const

const BEHAVIOR_FIELDS = [
  'ordersCountAtLeast',
  'ltvCentsAtLeast',
  'lastPurchaseWithinDays',
  'noPurchaseForDays',
] as const

describe('the rule editor reaches every field of the rule', () => {
  it('THE CONTROL: the fixture really does set all nine', () => {
    // Guard the guard. A fixture that had lost a field would make every
    // round-trip assertion below pass by never testing it.
    for (const field of RULE_FIELDS) {
      expect(FULL_RULE[field]).toBeDefined()
    }
    for (const field of BEHAVIOR_FIELDS) {
      expect(FULL_RULE.behavior?.[field]).toBeDefined()
    }
    expect(RULE_FIELDS).toHaveLength(8)
    expect(BEHAVIOR_FIELDS).toHaveLength(4)
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
