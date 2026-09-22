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
 * The shape of a filing entry (AGL-3274): the sentence, the diff a save
 * owes, and the document every door writes alike.
 */

import {
  buildCampaignFilingActivity,
  campaignFilingBody,
  campaignFilingChanges,
} from './campaign-filing-activity'

describe('campaignFilingBody', () => {
  it('names the campaign, and never prints an empty name', () => {
    expect(campaignFilingBody('filed', 'Outbound · ICP 2 brands')).toBe('Filed under Outbound · ICP 2 brands')
    expect(campaignFilingBody('removed', 'Outbound · ICP 2 brands')).toBe('Removed from Outbound · ICP 2 brands')
    expect(campaignFilingBody('filed', '  ')).toBe('Filed under a campaign')
  })
})

describe('campaignFilingChanges', () => {
  it('owes one entry per id added or dropped, and nothing for a reorder', () => {
    expect(campaignFilingChanges(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
    expect(campaignFilingChanges(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] })
    expect(campaignFilingChanges([], ['a'])).toEqual({ added: ['a'], removed: [] })
  })
})

describe('buildCampaignFilingActivity', () => {
  it('is a note by the member, on the record, carrying the CRM’s id and the campaign’s', () => {
    expect(
      buildCampaignFilingActivity({
        action: 'filed',
        campaign: { id: 'icp2', name: 'Outbound · ICP 2 brands' },
        link: { leadId: 'lead-key' },
        hostId: 'site-1',
        visibleTo: ['host:site-1'],
        atMs: 1_790_000_000_000,
        byUid: 'uid-a',
        byName: 'Ada Lovelace',
      }),
    ).toEqual({
      kind: 'note',
      body: 'Filed under Outbound · ICP 2 brands',
      atMs: 1_790_000_000_000,
      byUid: 'uid-a',
      byName: 'Ada Lovelace',
      leadId: 'lead-key',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      sourcePluginId: 'crm',
      campaignId: 'icp2',
    })
  })

  it('leaves the name out rather than blank, and links only what the caller named', () => {
    const entry = buildCampaignFilingActivity({
      action: 'removed',
      campaign: { id: 'icp2', name: 'Outbound' },
      link: { contactId: 'c-1' },
      hostId: 'site-1',
      visibleTo: ['org'],
      atMs: 1,
      byUid: '',
      byName: '  ',
    })
    expect(entry).not.toHaveProperty('byName')
    expect(entry).not.toHaveProperty('leadId')
    expect(entry.contactId).toBe('c-1')
    expect(entry.body).toBe('Removed from Outbound')
  })
})
