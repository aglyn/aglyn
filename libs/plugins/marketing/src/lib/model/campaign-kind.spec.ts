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

import { pluginContainerKind } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import { CAMPAIGN_KIND, CAMPAIGN_MEMBERSHIP_FIELD } from './campaign-kind'

/**
 * A campaign, as the container kind this plugin declares. The field is
 * PERSISTED — on every filed form, screen and lead, inside each holder's
 * facet on a contact, and in the indexes the member queries use — so the
 * kind's name is pinned here rather than left to agree with it by accident.
 */

describe('the campaign container kind', () => {
  it('is held in `campaignIds`, the field every filed record already carries', () => {
    expect(CAMPAIGN_MEMBERSHIP_FIELD).toBe('campaignIds')
  })

  it('is not the field a SEND carries', () => {
    // On a send, `campaignId` is the send's own id — what `cid` signs into
    // every unsubscribe link — so a send joins its container by
    // `emailCampaignId`. The plural is what says a record may be in several.
    expect(CAMPAIGN_MEMBERSHIP_FIELD).not.toBe('emailCampaignId')
    expect(CAMPAIGN_MEMBERSHIP_FIELD).not.toBe('campaignId')
  })

  it('is declared by this plugin, stored where its containers are', () => {
    expect(pluginContainerKind(CAMPAIGN_KIND)).toEqual({
      pluginId: 'marketing',
      kind: CAMPAIGN_KIND,
      label: 'Campaign',
      pluralLabel: 'Campaigns',
      ownerLabel: 'Marketing',
      orgCollection: 'emailCampaigns',
      nameField: 'name',
    })
  })
})
