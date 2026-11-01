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

import { readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import type { CrmActivityLink } from '@aglyn/aglyn/app-utils/crm'
import { contactPrimaryGroup } from './contact-holder'

/**
 * WHO, WHAT AND WHICH ACCOUNT AN ACTIVITY IS ABOUT (AGL-4123).
 *
 * Salesforce's activity model, on the three links an activity already had:
 * `contactId` is its Who (the **Name** field), `dealId` or `companyId` its
 * What (the **Related To** field), and `companyId` its Account, the rollup
 * that puts a call with a person, or about a deal, on the timeline of the
 * company behind them. Each timeline lists by its own field, so an entry
 * that carries all three shows on all three pages.
 *
 * Every writer of `crmActivities` stamps the Account here. A rollup a writer
 * spelled for itself is the one that would disagree: a company's timeline is
 * only as complete as the least careful door that writes to it.
 *
 * ## The order
 *
 * A company the writer named stands: it was said on purpose. Otherwise the
 * deal's, because the deal is the thing the entry is about; otherwise the
 * contact's.
 *
 * ## A contact's company is one holder's knowledge
 *
 * Which company a person is at lives in a holder's facet, and that is what is
 * read. `companyIds` is the facet's mirror for queries, and carries every
 * holder's link, so reading it here would file one business's call under a
 * company only a sibling brand knows the person by. A writer standing on a
 * site names that site's group; one standing at the organization names none
 * and reads the person's primary holder, the one their page shows.
 */

/** What the Account is worked out from, as the writer already holds it. */
export interface CrmActivityCompanySources {
  /** The deal the activity names, when the writer has read it. */
  deal?: Record<string, unknown> | null
  /** The contact the activity names, when the writer has read it. */
  contact?: Record<string, unknown> | null
  /** The holder whose facet is read; absent, the contact's primary holder. */
  groupId?: string | null
  /** The org document, for the primary holder when {@link groupId} is absent. */
  org?: Record<string, unknown> | null
}

/** A link as a stamp hands it back: what went in, and the company it found. */
export type StampedCrmActivityLink<Link extends CrmActivityLink> = Link &
  Pick<CrmActivityLink, 'companyId'>

/** A stored id, or `''` for anything that is not one. */
const idOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The company an activity rolls up to, or `null` when nothing names one. */
export function crmActivityCompanyId(
  link: Pick<CrmActivityLink, 'companyId'>,
  sources: CrmActivityCompanySources,
): string | null {
  const named = idOf(link.companyId) || idOf(sources.deal?.['companyId'])
  if (named) return named
  const { contact, org } = sources
  if (!contact) return null
  const groupId = sources.groupId || contactPrimaryGroup(contact, org).groupId
  return idOf(readContactFacet(contact, groupId).companyId) || null
}

/**
 * `link` with its Account stamped. A link with no company to find comes back
 * as it went in, with no blank key: Firestore refuses `undefined`.
 */
export function stampCrmActivityCompany<Link extends CrmActivityLink>(
  link: Link,
  sources: CrmActivityCompanySources,
): StampedCrmActivityLink<Link> {
  const companyId = crmActivityCompanyId(link, sources)
  return companyId && companyId !== link.companyId ? { ...link, companyId } : link
}

/** Each side's own way to read a record by id: the Admin SDK's, or the client's. */
export interface CrmActivityRecordReads {
  deal(id: string): Promise<Record<string, unknown> | null>
  contact(id: string): Promise<Record<string, unknown> | null>
}

/**
 * {@link stampCrmActivityCompany}, reading what the writer does not hold.
 *
 * The deal is read first and the contact only when the deal names no company,
 * so an activity costs the fewest reads that answer it, and none when a
 * company was named.
 *
 * **Never throws.** The rollup is bookkeeping beside the entry, and a record
 * this reader may not open, or a read that fails, must not cost the person
 * the call they are logging. The entry is written with the links it has, and
 * the company's timeline is the one thing it misses.
 */
export async function resolveCrmActivityCompany<Link extends CrmActivityLink>(
  link: Link,
  sources: CrmActivityCompanySources,
  reads: CrmActivityRecordReads,
): Promise<StampedCrmActivityLink<Link>> {
  if (link.companyId) return link
  const attempt = async (read: () => Promise<Record<string, unknown> | null>) => {
    try {
      return await read()
    } catch (error) {
      console.warn('[crm] a record could not be read for the activity rollup', error)
      return null
    }
  }
  const dealId = idOf(link.dealId)
  const deal = sources.deal ?? (dealId ? await attempt(() => reads.deal(dealId)) : null)
  const contactId = idOf(link.contactId)
  const contact =
    sources.contact ??
    (contactId && !idOf(deal?.['companyId'])
      ? await attempt(() => reads.contact(contactId))
      : null)
  return stampCrmActivityCompany(link, { ...sources, deal, contact })
}

/** What **Related To** names: one company or one deal, Salesforce's What. */
export interface CrmActivityRelated {
  kind: 'company' | 'deal'
  id: string
}

/** The two fields of the log dialog, as a person leaves them. */
export interface CrmActivityPicks {
  /** **Name**: the contact it was with, Salesforce's Who. */
  contactId: string | null
  /** **Related To**. */
  related: CrmActivityRelated | null
}

/**
 * The fields as they open on `link`: a new activity's record, or an activity
 * being edited. A deal outranks the company stamped beside it, because the
 * deal is the What and the company only its rollup.
 *
 * Opened from a deal, **Name** defaults to the deal's Primary, so the entry
 * lands on that person's timeline too. A link that already names a contact
 * keeps them.
 */
export function crmActivityPicksFrom(
  link: Pick<CrmActivityLink, 'contactId' | 'companyId' | 'dealId'>,
  primaryContactId?: string | null,
): CrmActivityPicks {
  const contactId = idOf(link.contactId) || idOf(primaryContactId)
  const dealId = idOf(link.dealId)
  const companyId = idOf(link.companyId)
  return {
    contactId: contactId || null,
    related: dealId
      ? { kind: 'deal', id: dealId }
      : companyId
        ? { kind: 'company', id: companyId }
        : null,
  }
}

/**
 * The links the fields name, before the Account is stamped. A lead's own log
 * keeps its lead: a person not yet converted is not a contact the field could
 * name.
 */
export function crmActivityLinkFromPicks(
  picks: CrmActivityPicks,
  leadId?: string | null,
): CrmActivityLink {
  const { contactId, related } = picks
  return {
    ...(contactId ? { contactId } : {}),
    ...(related?.kind === 'deal' ? { dealId: related.id } : {}),
    ...(related?.kind === 'company' ? { companyId: related.id } : {}),
    ...(leadId ? { leadId } : {}),
  }
}

/** Whether two sets of picks name the same records. */
export function crmActivityPicksEqual(a: CrmActivityPicks, b: CrmActivityPicks): boolean {
  return (
    a.contactId === b.contactId &&
    a.related?.kind === b.related?.kind &&
    a.related?.id === b.related?.id
  )
}
