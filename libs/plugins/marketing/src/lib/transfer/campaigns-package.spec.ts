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

import {
  CAMPAIGN_REFERENCE_KINDS,
  campaignDependencies,
  campaignPackageContent,
  draftableCampaignEmails,
  remapCampaignIds,
} from './campaigns-package'

const CONTAINER = {
  name: 'Spring',
  startAtMs: 10,
  endAtMs: null,
  listIds: ['list-1'],
  topicId: 'marketing',
  visibleTo: ['host:host-1'],
  createdAtMs: 1,
  createdBy: 'uid',
}
const EMAIL = {
  subject: 'Spring is here',
  preheader: 'Hi',
  status: 'sent',
  stats: { opens: 3 },
  audience: 'list',
  sendAtMs: 99,
  templateScreenId: 'design-1',
  hostId: 'host-1',
}

describe('a campaign as a package item (AGL-3535)', () => {
  it('carries its plan and its emails’ copy, never what was sent', () => {
    const content = campaignPackageContent(CONTAINER, [EMAIL])
    expect(content.emails).toEqual([
      { subject: 'Spring is here', preheader: 'Hi', subjectVariants: [], preheaderVariants: [], templateScreenId: 'design-1', hostId: 'host-1' },
    ])
    expect(JSON.stringify(content)).not.toMatch(/sent|opens|audience|sendAtMs|createdBy/)
  })

  it('reads an incoming item’s emails from the item itself', () => {
    const round = campaignPackageContent(campaignPackageContent(CONTAINER, [EMAIL]))
    expect(round).toEqual(campaignPackageContent(CONTAINER, [EMAIL]))
  })

  it('names its sites, lists, topic and designs, and leaves out an email whose design is dropped', () => {
    const content = campaignPackageContent(CONTAINER, [EMAIL])
    expect(campaignDependencies(content)).toEqual([
      { kind: 'site', id: 'host-1' },
      { kind: CAMPAIGN_REFERENCE_KINDS.list, id: 'list-1' },
      { kind: CAMPAIGN_REFERENCE_KINDS.topic, id: 'marketing' },
      { kind: CAMPAIGN_REFERENCE_KINDS.design, id: 'design-1' },
    ])
    const moved = remapCampaignIds(
      content,
      new Map([
        [`${CAMPAIGN_REFERENCE_KINDS.list}/list-1`, ''],
        [`${CAMPAIGN_REFERENCE_KINDS.design}/design-1`, ''],
      ]),
    )
    expect(moved.listIds).toEqual([])
    expect(draftableCampaignEmails(moved)).toEqual([])
  })

  it('points at the topic kept beside the workspace’s own, and at none when the topic is left out (AGL-3550)', () => {
    const content = campaignPackageContent(CONTAINER, [EMAIL])
    const topicKey = `${CAMPAIGN_REFERENCE_KINDS.topic}/marketing`
    expect(remapCampaignIds(content, new Map([[topicKey, 'copied-topic']])).topicId).toBe('copied-topic')
    expect(remapCampaignIds(content, new Map([[topicKey, '']])).topicId).toBeNull()
    expect(remapCampaignIds(content, new Map()).topicId).toBe('marketing')
  })
})
