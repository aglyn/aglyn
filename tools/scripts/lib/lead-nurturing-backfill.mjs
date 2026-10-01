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

// The decisions of the Nurturing backfill (AGL-3446), pure so they are
// pinned by `lead-nurturing-backfill.test.mjs`. The script reads, prints
// and writes; everything it decides is decided here.
//
// A lead belongs in Nurturing when it still stands in New — no status, or
// `new` — has not converted, and automated email has already reached it:
//
//  - an Outreach enrollment that names the lead sent it at least one email
//    (`lastSentAtMs`, a `messageIds` entry, or an email step record; an
//    enrollment from before step records were kept counts a `stepIndex`
//    past the first step), or
//  - a campaign send's reach record (`orgs/{orgId}/campaigns/{id}/reports/
//    reached`, keyed by the address's `personKey` — which is the lead's
//    document id) holds the lead, and the send's site holds the lead.
//
// The runtime makes the same move on every new send — `markOutreachLeadNurturing`
// in the outreach plugin, `nurtureReachedLeads` in the CRM plugin
// — so this converges the leads reached before either existed.

/** `CRM_LEAD_STATUSES`, restated: a `.mjs` under tools/ cannot import the TypeScript that owns it. */
export const LEAD_STATUSES = ['new', 'nurturing', 'working', 'qualified', 'unqualified']

/** `crmLeadStatus`, restated: an absent or unknown status is `new`. */
export function leadStatus(lead) {
  const status = lead?.status
  return LEAD_STATUSES.includes(status) ? status : 'new'
}

/** `ORG_SCOPE_TOKEN` and `hostScopeToken`, restated for `visibleToHost`. */
export function visibleToHost(visibleTo, hostId) {
  if (!Array.isArray(visibleTo)) return false
  return visibleTo.includes('org') || visibleTo.includes(`host:${hostId}`)
}

/** Whether an enrollment has sent its person at least one email. */
export function enrollmentSentEmail(enrollment) {
  if (!enrollment) return false
  if (Number(enrollment.lastSentAtMs) > 0) return true
  if (Array.isArray(enrollment.messageIds) && enrollment.messageIds.length > 0) return true
  if (Array.isArray(enrollment.stepRecords)) {
    return enrollment.stepRecords.some((record) => record?.kind === 'email')
  }
  return Number(enrollment.stepIndex) >= 1
}

/** The lead an enrollment names, whichever record it targets now. */
export function enrollmentLeadId(enrollment) {
  const leadId = enrollment?.leadId
  return typeof leadId === 'string' && leadId ? leadId : null
}

/**
 * Why a lead moves to Nurturing, or `null` when it stays.
 *
 * @param lead the lead document's data
 * @param evidence `{ enrolled: boolean, campaignHosts: string[] }` — whether
 *   an enrollment sent the lead an email, and the sites of the campaign sends
 *   whose reach holds its key (`''` for a send that records no site)
 * @returns `'sequence' | 'campaign' | null`
 */
export function planLeadNurturing(lead, evidence) {
  if (!lead || lead.convertedContactId) return null
  if (leadStatus(lead) !== 'new') return null
  if (evidence?.enrolled) return 'sequence'
  const hosts = evidence?.campaignHosts ?? []
  if (hosts.some((hostId) => !hostId || visibleToHost(lead.visibleTo, hostId))) return 'campaign'
  return null
}
