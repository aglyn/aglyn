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

// The decisions of `backfill-crm-enrollment-activity.mjs` (AGL-3274), pure,
// so `enrollment-activity-backfill.test.mjs` can pin them without a database.
//
// Every enrollment made before the enroll route filed "Enrolled in" on the
// person's record is owed that entry, at the enrollment's own creation
// time, under the SAME id and with the SAME words the route files it by —
// so the route and this script can never file the entry twice, whichever
// runs first. Three things are restated from the TypeScript that owns them,
// and the test reads that source to hold the restatements to it:
//
//  - the id: the timeline seam's keyed id (`record-timeline.ts`), `plg_`
//    over sha256 of `<plugin>:<key>`, with Outreach's key
//    (`enrollment-activity.ts`) `enrolled:<enrollmentId>`;
//  - the words: `outreachEnrolledEntry`'s two lines;
//  - the scope: `crmScopeTokens` over `consentGroupForHost` — `['org']`
//    where the organization widened its default, else one `host:` token
//    per site of the consent group the site is in, else the site alone.

import { createHash } from 'node:crypto'
import { toMs } from './email-state-backfill.mjs'

/** Outreach's plugin id, as it signs the seam. */
export const OUTREACH_PLUGIN_ID = 'outreach'

/** The author every entry the runtime files is signed with. */
export const OUTREACH_TIMELINE_BY_NAME = 'Sequences'

/** The most sites a consent group may name — `MAX_SCOPE_HOSTS`. */
export const MAX_CONSENT_GROUP_HOSTS = 30

/** `outreachEnrolledEntryKey`, restated. */
export function enrolledEntryKey(enrollmentId) {
  return `enrolled:${enrollmentId}`
}

/** The timeline seam's `keyedId`, restated: the plugin's namespace over its key. */
export function keyedActivityId(pluginId, key) {
  return `plg_${createHash('sha256').update(`${pluginId}:${key}`).digest('hex').slice(0, 28)}`
}

/** The id the route files an enrollment's entry under. */
export function enrolledActivityId(enrollmentId) {
  return keyedActivityId(OUTREACH_PLUGIN_ID, enrolledEntryKey(enrollmentId))
}

/** `outreachEnrolledEntry`'s body, restated. */
export function enrolledActivityBody(sequenceName, campaignNames) {
  const sequence = String(sequenceName ?? '').trim() || 'a sequence'
  const campaigns = (campaignNames ?? []).map((name) => String(name ?? '').trim()).filter(Boolean)
  return campaigns.length ? `Enrolled in ${sequence}\nFiled under ${campaigns.join(', ')}` : `Enrolled in ${sequence}`
}

/**
 * `readConsentGroups`, restated: the usable groups of an org document —
 * named, two to thirty distinct sites, an id that is no site's id, and no
 * site claimed by two groups (both are dropped).
 */
export function readConsentGroups(org) {
  const raw = org?.consentGroups
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const siteIds = consentGroupSiteIds(org, raw)
  const usable = {}
  for (const [groupId, value] of Object.entries(raw)) {
    if (!groupId || !value || typeof value !== 'object') continue
    if (siteIds.has(groupId)) continue
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!name) continue
    const hostIds = Array.isArray(value.hostIds)
      ? [...new Set(value.hostIds.map((id) => String(id ?? '').trim()).filter(Boolean))].sort()
      : []
    if (hostIds.length < 2 || hostIds.length > MAX_CONSENT_GROUP_HOSTS) continue
    usable[groupId] = { name, hostIds }
  }
  const claims = new Map()
  for (const group of Object.values(usable)) {
    for (const hostId of group.hostIds) claims.set(hostId, (claims.get(hostId) ?? 0) + 1)
  }
  const contested = new Set([...claims.entries()].filter(([, count]) => count > 1).map(([id]) => id))
  if (!contested.size) return usable
  const settled = {}
  for (const [groupId, group] of Object.entries(usable)) {
    if (group.hostIds.some((hostId) => contested.has(hostId))) continue
    settled[groupId] = group
  }
  return settled
}

/**
 * `consentGroupSiteIds`, restated: the org's `hosts` (map or list) and every
 * site any raw entry names, usable or not — the ids a group id may not take.
 */
function consentGroupSiteIds(org, raw) {
  const ids = new Set()
  const hosts = org?.hosts
  if (Array.isArray(hosts)) {
    for (const id of hosts) if (typeof id === 'string' && id) ids.add(id)
  } else if (hosts && typeof hosts === 'object') {
    for (const id of Object.keys(hosts)) if (id) ids.add(id)
  }
  for (const value of Object.values(raw)) {
    if (!Array.isArray(value?.hostIds)) continue
    for (const id of value.hostIds) {
      const trimmed = String(id ?? '').trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return ids
}

/** `crmScopeTokens(org, consentGroupForHost(org, hostId))`, restated. */
export function scopeTokens(org, hostId) {
  if (org?.defaultResourceScope === 'org') return ['org']
  for (const group of Object.values(readConsentGroups(org))) {
    if (group.hostIds.includes(hostId)) return group.hostIds.map((id) => `host:${id}`)
  }
  return [`host:${hostId}`]
}

/** `outreachEnrollmentLink`, restated: the lead while they are one, else the contact. */
export function enrollmentLink(enrollment) {
  if (enrollment.target === 'lead' && enrollment.leadId) return { leadId: String(enrollment.leadId) }
  if (enrollment.contactId) return { contactId: String(enrollment.contactId) }
  return null
}

/**
 * The entry one enrollment is owed, or `null` when it is owed nothing:
 * already filed (`existing`), or naming no record, no site, or no moment.
 *
 * @param input.enrollmentId the enrollment document's id
 * @param input.enrollment its data
 * @param input.sequenceName the sequence's name as it stands, or `''` when it is gone
 * @param input.campaignNames the names of the campaigns the enrollment carried, in its order
 * @param input.org the organization document, for the scope
 * @param input.existing whether `crmActivities/{id}` already exists
 * @returns `{ id, activity }` — the document minus its timestamps — or `null`
 */
export function planEnrollmentActivity(input) {
  const { enrollmentId, enrollment, sequenceName, campaignNames, org, existing } = input
  if (existing) return null
  const link = enrollmentLink(enrollment ?? {})
  const hostId = String(enrollment?.hostId ?? '').trim()
  const atMs = toMs(enrollment?.createdAtMs) || toMs(enrollment?.createdAt)
  if (!link || !hostId || !atMs) return null
  return {
    id: enrolledActivityId(enrollmentId),
    activity: {
      kind: 'note',
      body: enrolledActivityBody(sequenceName, campaignNames),
      atMs,
      byUid: '',
      byName: OUTREACH_TIMELINE_BY_NAME,
      ...link,
      hostId,
      visibleTo: scopeTokens(org, hostId),
      sourcePluginId: OUTREACH_PLUGIN_ID,
    },
  }
}
