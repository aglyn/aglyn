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

import type { CrmActivity, CrmActivityLink, ScopeToken } from '@aglyn/aglyn'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * WHAT A FILING WRITES ON THE RECORD'S TIMELINE (AGL-3274).
 *
 * A lead or a contact filed under a campaign — from its own page, the bulk
 * bar, the New lead drawer, or by conversion carrying a lead's campaigns
 * onto the contact it became — showed nothing of it in Activity, so the
 * timeline read "email sent" with no line for the act that put the person
 * in the campaign in the first place. Every door now files one entry per
 * campaign changed, and this module is the one place their shape lives:
 * the client hook and the server helper both build the document here, so
 * an entry filed from the page and one filed by the conversion read alike.
 *
 * ## A `note`, not a kind of its own
 *
 * The timeline's kinds are what a PERSON logs — call, email, meeting, note
 * — and a filing is bookkeeping beside them, the way a sequence's "Enrolled
 * in" entry is. A `filing` kind would need its own label, glyph, report
 * column and a place in the log dialog where a member could log one by
 * hand, which is the one thing a filing must never be. So it is a note that
 * names its author (the member, or the conversion), carries the CRM's own
 * id as `sourcePluginId` the way a sequence's entries carry Outreach's, and
 * names the campaign twice: by name in the body, by id in `campaignId`.
 */

/** The kind every filing entry is filed as. */
export const CAMPAIGN_FILING_ACTIVITY_KIND = 'note' as const

/** What the entry says was done: put in the campaign, or taken out of it. */
export type CampaignFilingAction = 'filed' | 'removed'

/** A campaign as a filing entry names it: the container's id and its name at the time. */
export interface CampaignFilingRef {
  id: string
  name: string
}

/**
 * The author a conversion's carry signs its entries with: nobody in the
 * room typed it, and "A team member" — the timeline's word for an
 * anonymous entry — would credit a person with what the conversion did.
 */
export const CAMPAIGN_FILING_CARRY_BY_NAME = 'Lead conversion'

/** The one line of the entry, as the timeline shows it. */
export function campaignFilingBody(action: CampaignFilingAction, campaignName: string): string {
  const name = campaignName.trim() || 'a campaign'
  return action === 'filed' ? `Filed under ${name}` : `Removed from ${name}`
}

/**
 * The membership a save changed, as the entries it owes: one `filed` per
 * id the save added, one `removed` per id it dropped. Order-insensitive,
 * like `campaignMembershipUnchanged`; a reorder owes nothing.
 */
export function campaignFilingChanges(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  }
}

export interface CampaignFilingActivityInput {
  action: CampaignFilingAction
  campaign: CampaignFilingRef
  link: CrmActivityLink
  /** The site the entry carries as provenance — the lead's site, the contact's viewing site. */
  hostId: string
  visibleTo: readonly ScopeToken[]
  /** When it happened, epoch ms. */
  atMs: number
  /** The member who did it, or `''` for the conversion. */
  byUid: string
  /** The member's name as it read, or the carry's fixed author; absent rather than blank. */
  byName?: string | null
}

/** The document a filing entry is stored as, minus the timestamps the writer stamps. */
export function buildCampaignFilingActivity(input: CampaignFilingActivityInput): CrmActivity {
  const byName = String(input.byName ?? '').trim()
  return {
    kind: CAMPAIGN_FILING_ACTIVITY_KIND,
    body: campaignFilingBody(input.action, input.campaign.name),
    atMs: input.atMs,
    byUid: input.byUid,
    ...(byName ? { byName } : {}),
    ...(input.link.contactId ? { contactId: input.link.contactId } : {}),
    ...(input.link.companyId ? { companyId: input.link.companyId } : {}),
    ...(input.link.dealId ? { dealId: input.link.dealId } : {}),
    ...(input.link.leadId ? { leadId: input.link.leadId } : {}),
    hostId: input.hostId,
    visibleTo: [...input.visibleTo],
    sourcePluginId: BUNDLE_ID,
    campaignId: input.campaign.id,
  }
}
