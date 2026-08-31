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
 * THE EDGE, AND THE TWO WAYS IT GOES QUIETLY WRONG.
 *
 * Both failures this module exists to stop are silent, which is why they are
 * asserted rather than reasoned about:
 *
 *  1. **Clearing the last campaign reads as no change.** An empty selection
 *     has to be STORED. A writer that skipped the write when nothing was
 *     picked would let a merchant take a form out of its last campaign, see
 *     the drawer close, and find it still assigned on reload.
 *  2. **A second assignment erases the first.** The field is an array
 *     precisely because a landing page outlives one push, so a helper that
 *     collapsed it to one value would un-file a record from last quarter's
 *     campaign with nothing on screen to say so.
 */

import {
  CAMPAIGN_MEMBERSHIP_CAP,
  CAMPAIGN_MEMBERSHIP_FIELD,
  CAMPAIGN_MEMBER_HOST_COLLECTIONS,
  campaignMembershipUnchanged,
  campaignMembershipValue,
  contactCampaignFieldPath,
  normalizeCampaignIds,
  readCampaignIds,
  readContactCampaignIds,
} from './campaign-membership'
import { contactFacetPath } from './contacts'

describe('the field a resource carries', () => {
  it('is not the field a SEND carries', () => {
    /*
     * The names have to differ. On a send `campaignId` already means the
     * send's own id — it is what `cid` puts inside every unsubscribe HMAC —
     * so the container field there is `emailCampaignId`. A form has no such
     * second meaning, and the plural is what says a record may be in several.
     */
    expect(CAMPAIGN_MEMBERSHIP_FIELD).toBe('campaignIds')
    expect(CAMPAIGN_MEMBERSHIP_FIELD).not.toBe('emailCampaignId')
  })

  it('is read off a host resource as a clean list', () => {
    expect(
      readCampaignIds({ [CAMPAIGN_MEMBERSHIP_FIELD]: ['a', 'b'] }),
    ).toEqual(['a', 'b'])
    expect(readCampaignIds({})).toEqual([])
    expect(readCampaignIds(null)).toEqual([])
  })

  it('names the collections a campaign deletion has to walk', () => {
    // The picker and the detach read the same list, so a collection that
    // grows one grows the other.
    expect([...CAMPAIGN_MEMBER_HOST_COLLECTIONS]).toEqual(['forms', 'screens'])
  })
})

describe('normalizing what a writer stored', () => {
  it('drops blanks, non-strings and duplicates', () => {
    expect(
      normalizeCampaignIds([' spring ', 'spring', '', null, 7, 'summer']),
    ).toEqual(['spring', 'summer'])
  })

  it('answers empty for a field no writer has ever set', () => {
    expect(normalizeCampaignIds(undefined)).toEqual([])
    expect(normalizeCampaignIds('spring')).toEqual([])
  })

  it('caps the array, so a runaway writer cannot grow it forever', () => {
    const many = Array.from(
      { length: CAMPAIGN_MEMBERSHIP_CAP + 10 },
      (_, index) => `campaign-${index}`,
    )
    expect(normalizeCampaignIds(many)).toHaveLength(CAMPAIGN_MEMBERSHIP_CAP)
  })
})

describe('what a save writes', () => {
  it('STORES an empty array when every campaign is cleared', () => {
    /*
     * The control for failure (1). `[]` and `undefined` read the same to
     * every reader in this module, so a helper that answered `undefined`
     * would pass every read assertion above and still ship a Clear button
     * that does nothing — the caller spreads the result into an update, and
     * `undefined` is a key Firestore never writes.
     */
    const value = campaignMembershipValue([])
    expect(value).toEqual([])
    expect(value).not.toBeUndefined()
  })

  it('keeps every campaign picked, not the last one', () => {
    // The control for failure (2).
    expect(campaignMembershipValue(['spring', 'summer'])).toEqual([
      'spring',
      'summer',
    ])
  })

  it('cleans what the picker hands back', () => {
    expect(campaignMembershipValue([' spring ', 'spring'])).toEqual(['spring'])
  })
})

describe('whether a save has anything to do', () => {
  it('ignores the order the two lists happen to be in', () => {
    /*
     * A picker hands back its OPTIONS' order and the document holds the order
     * it was written in, so a literal comparison would report a change on
     * every open — leaving Save permanently enabled and every page visit
     * writing.
     */
    expect(campaignMembershipUnchanged(['a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('sees an addition, a removal and a clear', () => {
    expect(campaignMembershipUnchanged(['a'], ['a', 'b'])).toBe(false)
    expect(campaignMembershipUnchanged(['a', 'b'], ['a'])).toBe(false)
    expect(campaignMembershipUnchanged(['a'], [])).toBe(false)
  })
})

describe('a contact, whose membership is one holder’s own', () => {
  it('writes inside that holder’s facet and nowhere else', () => {
    /*
     * A contact row is shared by every site in the org. Which campaigns a
     * merchant filed somebody under is their business record on the same
     * footing as their notes, so the path has to name the group — a top-level
     * field would be readable by every other site in an agency's account.
     */
    expect(contactCampaignFieldPath('group-a')).toBe(
      'facets.group-a.campaignIds',
    )
    expect(contactCampaignFieldPath('group-a')).toBe(
      contactFacetPath('group-a', CAMPAIGN_MEMBERSHIP_FIELD),
    )
  })

  it('reads only the asking holder’s filing', () => {
    const contact = {
      email: 'someone@example.com',
      facets: {
        'group-a': { campaignIds: ['spring'] },
        'group-b': { campaignIds: ['rival-push'] },
      },
    }
    expect(readContactCampaignIds(contact, 'group-a')).toEqual(['spring'])
    // The control: a reader that fell back to the document, or to another
    // facet, would hand one business another's segmentation of a person they
    // both know.
    expect(readContactCampaignIds(contact, 'group-a')).not.toContain(
      'rival-push',
    )
    expect(readContactCampaignIds(contact, 'group-c')).toEqual([])
  })

  it('answers empty for a contact captured before campaigns were filed', () => {
    expect(readContactCampaignIds({ email: 'a@b.co' }, 'group-a')).toEqual([])
    expect(readContactCampaignIds(null, 'group-a')).toEqual([])
  })
})
