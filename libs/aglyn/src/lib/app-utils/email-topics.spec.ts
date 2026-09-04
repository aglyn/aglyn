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
 * The topic catalog's merge rules, which three surfaces depend on agreeing:
 * the console card, the composer's picker and the unauthenticated preference
 * page. All three read `mergeEmailTopics`, so a defect here is the same defect
 * three times.
 */

import {
  activeEmailTopics,
  doubleOptInExpired,
  isEmailTopicId,
  mergeEmailTopics,
  normalizeEmailTopic,
  readTopicSubscriptionState,
  resolveCampaignTopic,
  topicRequiresDoubleOptIn,
  DEFAULT_CAMPAIGN_TOPIC_ID,
  DEFAULT_EMAIL_TOPICS,
  DEFAULT_SITE_DOUBLE_OPT_IN,
  DOUBLE_OPT_IN_EXPIRY_MS,
} from './email-topics'

describe('isEmailTopicId', () => {
  it('accepts an id `createResourceUid` can mint', () => {
    // nanoid's alphabet. If this ever fails, the topics card mints ids the
    // send path refuses and no campaign can be sent under a custom topic.
    expect(isEmailTopicId('V1StGXR8_Z')).toBe(true)
  })

  it('refuses a COLON, which is what keeps the signed subject unambiguous', () => {
    // `host:email:cid:tid` is byte-identical to a three-part subject whose
    // campaign id is `cid:tid`. A colon here would make one signature verify
    // two different parameter tuples.
    expect(isEmailTopicId('news:letter')).toBe(false)
  })

  it('refuses a path separator, reserved form, traversal and emptiness', () => {
    expect(isEmailTopicId('a/b')).toBe(false)
    expect(isEmailTopicId('__proto__')).toBe(false)
    expect(isEmailTopicId('.')).toBe(false)
    expect(isEmailTopicId('..')).toBe(false)
    expect(isEmailTopicId('')).toBe(false)
    expect(isEmailTopicId(undefined)).toBe(false)
  })
})

describe('mergeEmailTopics', () => {
  it('gives an org with no stored topics the built-in floor', () => {
    // The reason there is no seeding migration: every tenant that exists today
    // has an empty collection, and this is what they see anyway.
    expect(mergeEmailTopics(null).map((topic) => topic.id)).toEqual(
      DEFAULT_EMAIL_TOPICS.map((topic) => topic.id),
    )
  })

  it('lets a stored document rename a built-in without removing it', () => {
    const merged = mergeEmailTopics([
      { id: 'newsletter', name: 'The Dispatch', description: 'Monthly.' },
    ])
    const found = merged.find((topic) => topic.id === 'newsletter')
    expect(found).toEqual({
      id: 'newsletter',
      name: 'The Dispatch',
      description: 'Monthly.',
    })
    // Still four: an override REPLACES a built-in in place rather than being
    // appended beside it, or the catalog would show the topic twice.
    expect(merged).toHaveLength(DEFAULT_EMAIL_TOPICS.length)
  })

  it('keeps the built-ins when the org adds one of its own', () => {
    // The whole point of overlaying rather than replacing: adding a topic must
    // not silently delete the four every recipient has been unsubscribing
    // against.
    const merged = mergeEmailTopics([
      { id: 'zzz', name: 'Events', description: '' },
    ])
    expect(merged).toHaveLength(DEFAULT_EMAIL_TOPICS.length + 1)
    expect(merged[merged.length - 1].id).toBe('zzz')
  })

  it('puts the built-ins first in declared order and custom topics after', () => {
    const merged = mergeEmailTopics([
      { id: 'zeta', name: 'Zeta', description: '' },
      { id: 'alpha', name: 'Alpha', description: '' },
    ])
    expect(merged.map((topic) => topic.id)).toEqual([
      ...DEFAULT_EMAIL_TOPICS.map((topic) => topic.id),
      'alpha',
      'zeta',
    ])
  })

  it('ignores a stored document whose id could not be signed', () => {
    expect(
      mergeEmailTopics([{ id: 'a:b', name: 'Bad', description: '' }]),
    ).toHaveLength(DEFAULT_EMAIL_TOPICS.length)
  })
})

describe('activeEmailTopics', () => {
  it('hides an archived topic from the composer and the preference page', () => {
    const merged = mergeEmailTopics([
      {
        id: 'sales',
        name: 'Sales outreach',
        description: '',
        archived: true,
      },
    ])
    // Still in the CATALOG — links already sent under it must go on resolving.
    expect(merged.some((topic) => topic.id === 'sales')).toBe(true)
    expect(activeEmailTopics(merged).some((topic) => topic.id === 'sales')).toBe(
      false,
    )
  })
})

describe('normalizeEmailTopic', () => {
  it('falls back to the id rather than rendering a blank checkbox', () => {
    expect(normalizeEmailTopic('offers', { description: 'x' })).toEqual({
      id: 'offers',
      name: 'offers',
      description: 'x',
    })
  })

  it('marks archived only on an explicit true', () => {
    expect(
      normalizeEmailTopic('offers', { name: 'Offers', archived: 'yes' }),
    ).toEqual({ id: 'offers', name: 'Offers', description: '' })
  })

  it('refuses a document whose id is not a topic id', () => {
    expect(normalizeEmailTopic('a/b', { name: 'Offers' })).toBeNull()
  })
})

describe('resolveCampaignTopic', () => {
  const catalog = mergeEmailTopics(null)

  it('finds the campaign’s own topic', () => {
    expect(resolveCampaignTopic('newsletter', catalog).id).toBe('newsletter')
  })

  it('resolves a campaign sent before topics existed to the default', () => {
    // Those links are in inboxes right now. The preference page has to name A
    // topic for them, not report that the message came from nowhere.
    expect(resolveCampaignTopic('', catalog).id).toBe(DEFAULT_CAMPAIGN_TOPIC_ID)
    expect(resolveCampaignTopic(null, catalog).id).toBe(
      DEFAULT_CAMPAIGN_TOPIC_ID,
    )
  })

  it('resolves a topic that has since been removed from the catalog', () => {
    expect(resolveCampaignTopic('deleted-topic', catalog).id).toBe(
      DEFAULT_CAMPAIGN_TOPIC_ID,
    )
  })

  it('prefers the DEFAULT over whatever happens to be first', () => {
    // The built-in catalog puts `marketing` first, so a fallback that merely
    // took `topics[0]` would look correct against it forever. This is the
    // catalog that tells them apart.
    const reordered = [
      { id: 'events', name: 'Events', description: '' },
      { id: DEFAULT_CAMPAIGN_TOPIC_ID, name: 'Promotions', description: '' },
    ]
    expect(resolveCampaignTopic('nope', reordered).id).toBe(
      DEFAULT_CAMPAIGN_TOPIC_ID,
    )
  })

  it('falls back to the first topic when even the default is gone', () => {
    const trimmed = [{ id: 'only', name: 'Only', description: '' }]
    expect(resolveCampaignTopic('nope', trimmed).id).toBe('only')
  })
})

/**
 * DOUBLE OPT-IN — `docs/specs/email-competitive-gaps.md` P8.
 *
 * Of the ten vendors examined none mandates it, so every assertion below is
 * written to fail in both directions: the default is checked as OFF, and each
 * of the three states of a topic's own setting is checked against the other
 * two.
 */
describe('topicRequiresDoubleOptIn', () => {
  it('is off when nobody has asked for it', () => {
    expect(topicRequiresDoubleOptIn(undefined)).toBe(false)
    expect(topicRequiresDoubleOptIn({})).toBe(false)
    expect(DEFAULT_SITE_DOUBLE_OPT_IN).toBe(false)
  })

  it('takes the site’s answer when the topic has none', () => {
    expect(topicRequiresDoubleOptIn({}, true)).toBe(true)
    expect(topicRequiresDoubleOptIn({}, false)).toBe(false)
  })

  /**
   * A stored `false` is a decision, not an absence. It is what lets a
   * merchant confirm everything except one order-related stream, and a
   * reading that collapsed it into "unset" would take that away.
   */
  it('lets a topic overrule the site in BOTH directions', () => {
    expect(topicRequiresDoubleOptIn({ doubleOptIn: true }, false)).toBe(true)
    expect(topicRequiresDoubleOptIn({ doubleOptIn: false }, true)).toBe(false)
  })
})

describe('normalizeEmailTopic and the confirmation setting', () => {
  it('carries a stored boolean through, either way', () => {
    expect(normalizeEmailTopic('t', { doubleOptIn: true })?.doubleOptIn).toBe(
      true,
    )
    expect(normalizeEmailTopic('t', { doubleOptIn: false })?.doubleOptIn).toBe(
      false,
    )
  })

  it('leaves the field ABSENT when the document has no boolean', () => {
    // Absent is the third state — "ask the site" — so coercing with `=== true`
    // the way `archived` does would erase it.
    expect(normalizeEmailTopic('t', {})).not.toHaveProperty('doubleOptIn')
    expect(normalizeEmailTopic('t', { doubleOptIn: 'yes' })).not.toHaveProperty(
      'doubleOptIn',
    )
  })
})

describe('readTopicSubscriptionState', () => {
  it('reads no entry at all as subscribed', () => {
    expect(readTopicSubscriptionState(undefined)).toBe('subscribed')
    expect(readTopicSubscriptionState(null)).toBe('subscribed')
    expect(readTopicSubscriptionState({})).toBe('subscribed')
  })

  it('reads a live opt-out, and a lifted one as subscribed', () => {
    expect(
      readTopicSubscriptionState({ optedOutAt: 1, resubscribedAt: null }),
    ).toBe('opted-out')
    expect(readTopicSubscriptionState({ optedOutAt: 1, resubscribedAt: 2 })).toBe(
      'subscribed',
    )
  })

  it('reads an unanswered confirmation as pending, and an answered one as subscribed', () => {
    expect(readTopicSubscriptionState({ pendingAt: 1, confirmedAt: null })).toBe(
      'pending',
    )
    expect(readTopicSubscriptionState({ pendingAt: 1, confirmedAt: 2 })).toBe(
      'subscribed',
    )
  })

  /**
   * Leaving is the more recent and more explicit act, and a pending
   * confirmation that could outrank it would be a way to re-arm sending by
   * asking again.
   */
  it('lets a refusal outrank a pending confirmation', () => {
    expect(
      readTopicSubscriptionState({
        optedOutAt: 5,
        resubscribedAt: null,
        pendingAt: 9,
        confirmedAt: null,
      }),
    ).toBe('opted-out')
  })

  it('is not fooled by a confirmed entry that carries no resubscribedAt', () => {
    // The shorthand this function replaced — "an entry with no
    // `resubscribedAt` is a live opt-out" — reads this as somebody who left.
    expect(readTopicSubscriptionState({ pendingAt: 1, confirmedAt: 2 })).not.toBe(
      'opted-out',
    )
  })
})

describe('doubleOptInExpired', () => {
  const NOW = 1_800_000_000_000

  it('is good inside the window and stale outside it', () => {
    expect(doubleOptInExpired(NOW - DOUBLE_OPT_IN_EXPIRY_MS + 1, NOW)).toBe(false)
    expect(doubleOptInExpired(NOW - DOUBLE_OPT_IN_EXPIRY_MS - 1, NOW)).toBe(true)
  })

  it('is still good on the last moment of the window', () => {
    // Three days means three days, not three days minus an instant. The
    // boundary is where an expiry silently loses a day.
    expect(doubleOptInExpired(NOW - DOUBLE_OPT_IN_EXPIRY_MS, NOW)).toBe(false)
  })

  it('is three days, which is Klaviyo’s and not Brevo’s thirty', () => {
    expect(DOUBLE_OPT_IN_EXPIRY_MS).toBe(72 * 60 * 60 * 1000)
  })

  it('treats an unusable or missing instant as expired', () => {
    for (const at of [null, undefined, 0, Number.NaN, -1]) {
      expect(doubleOptInExpired(at, NOW)).toBe(true)
    }
  })
})
