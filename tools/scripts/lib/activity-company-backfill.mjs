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

// The decisions of `backfill-crm-activity-company.mjs` (AGL-4123), pure, so
// `activity-company-backfill.test.mjs` can pin them without a database.
//
// An activity logged before every writer stamped the company it rolls up to
// names a deal or a contact and no company, so it is missing from that
// company's timeline. This is the same rule the writers follow, restated from
// the TypeScript that owns it (`model/crm-activity-link.ts`) because a script
// cannot import it, and the test reads that source to hold the restatement to
// it: a company the row names stands, then the deal's, then the contact's.
//
// A contact's company is one holder's knowledge, so it is read from the facet
// of the holder the entry was logged as: the site's group, or the person's
// primary holder for an entry from no site. `companyIds`, the mirror carrying
// every holder's link, is never read: that would file one business's call
// under a company only a sibling brand knows the person by. The facet of a
// person the organization added itself is the whole org's, so it answers for
// any site with no link of its own.

import { readConsentGroups } from './enrollment-activity-backfill.mjs'

/** `ORG_CONTACT_HOLDER_ID`, restated: the facet the organization itself holds. */
export const ORG_HOLDER = 'org'

/** A stored id, or `''` for anything that is not one. */
const idOf = (value) => (typeof value === 'string' ? value.trim() : '')

/** `consentGroupForHost(...).groupId`, restated: the declared group, else the site. */
export function groupIdForHost(org, hostId) {
  for (const [groupId, group] of Object.entries(readConsentGroups(org))) {
    if (group.hostIds.includes(hostId)) return groupId
  }
  return hostId
}

/**
 * `contactPrimaryGroup(...).groupId`, restated: the organization's own facet,
 * then the first capturing site whose group holds a facet, then any facet, then
 * the first capturing site.
 */
export function primaryGroupId(contact, org) {
  const facets = contact?.facets
  const keys = facets && typeof facets === 'object' && !Array.isArray(facets) ? Object.keys(facets) : []
  if (keys.includes(ORG_HOLDER)) return ORG_HOLDER
  const raw = contact?.capturedByHostIds
  const captured = (Array.isArray(raw) ? raw : []).map((id) => String(id ?? '').trim()).filter(Boolean)
  for (const hostId of captured) {
    const groupId = groupIdForHost(org, hostId)
    if (keys.includes(groupId)) return groupId
  }
  if (keys.length) return keys[0]
  return captured.length ? groupIdForHost(org, captured[0]) : ''
}

/** The company `contact` is filed under, as the holder the entry was logged as knows it. */
export function contactCompanyId(contact, activity, org) {
  if (!contact) return ''
  const hostId = idOf(activity.hostId)
  const groupId = hostId ? groupIdForHost(org, hostId) : primaryGroupId(contact, org)
  return idOf(contact.facets?.[groupId]?.companyId) || idOf(contact.facets?.[ORG_HOLDER]?.companyId)
}

/**
 * What one activity is owed.
 *
 * `{ companyId, from }` for a row to stamp, naming the record the company came
 * from, or `{ skip }` with the reason there is nothing to do: `named` a row
 * that has its company, `no-record` one about neither a deal nor a contact,
 * `no-company` one whose records name none, or are gone.
 */
export function planActivityCompany({ activity, deal, contact, org }) {
  if (idOf(activity.companyId)) return { skip: 'named' }
  if (!idOf(activity.dealId) && !idOf(activity.contactId)) return { skip: 'no-record' }
  const fromDeal = idOf(deal?.companyId)
  if (fromDeal) return { companyId: fromDeal, from: `deal ${activity.dealId}` }
  const fromContact = contactCompanyId(contact, activity, org)
  if (fromContact) return { companyId: fromContact, from: `contact ${activity.contactId}` }
  return { skip: 'no-company' }
}

/** One line of the dry run: the row, what it holds now, and what it would. */
export function describeActivityCompany({ orgId, id, activity, plan }) {
  const about = [activity.kind, activity.contactId && `contact ${activity.contactId}`, activity.dealId && `deal ${activity.dealId}`]
    .filter(Boolean)
    .join(', ')
  return `  ${orgId}/${id} (${about}): companyId — → ${plan.companyId}, from ${plan.from}`
}
