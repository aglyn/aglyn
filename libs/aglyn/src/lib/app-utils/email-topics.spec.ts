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
  isEmailTopicId,
  mergeEmailTopics,
  normalizeEmailTopic,
  resolveCampaignTopic,
  DEFAULT_CAMPAIGN_TOPIC_ID,
  DEFAULT_EMAIL_TOPICS,
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
