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
  checkEntitlement,
  consentGroupForHost,
  CRM_COLLECTIONS,
  type CrmActivity,
  type CrmActivityLink,
  type CrmTask,
  crmActivityLogHasRoom,
  crmBookingFollowUpDueMs,
  crmBookingFollowUpTitle,
  crmBookingMeetingBody,
  crmScopeTokens,
  isHostPluginEnabled,
  parseCrmBookingRef,
  readContactFacet,
  visibleToHost,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { findContactByEmail } from './contact-email-index'
import { countCrmActivitiesForRecord } from './crm-records'

/**
 * WHAT A BOOKING FILES ON THE CRM RECORD (AGL-2660).
 *
 * A confirmed booking is a meeting the record has on its calendar, and the
 * timeline should say so without a rep logging it by hand. So once a
 * booking's row is written — at creation for a free service, on payment
 * for a paid one — the record is found and a `meeting` activity filed under
 * it, with a follow-up task beside it when the service asks for one.
 *
 * ## Which record
 *
 * The reference the booking link carried wins: `crmRef` names the contact,
 * lead or deal the rep dropped the link from, and a booking made through
 * that link belongs to that record even when the booker typed a different
 * address. Without one — a booking taken off the widget cold — the booker's
 * address is looked up through the org's address index, narrowed to this
 * site, exactly as the automation steps resolve an event's contact. A
 * reference to a record the site cannot see, or that no longer exists,
 * falls through to the address rather than filing under nobody.
 *
 * ## Where it lives
 *
 * In the admin library rather than the Bookings plugin, because the row is
 * a CRM record: its scope, its ceiling and its collections are the CRM's,
 * and a plugin that stamped its own would be a second creator to keep in
 * step with `crmScopeTokens`. The Bookings plugin passes what it already
 * holds and reads the outcome; the CRM plugin is never imported.
 *
 * Firestore is a parameter, as in `crm-records.ts`: the callers hold one,
 * and a module that reached for the Admin app itself would drag it into
 * every spec that only wants the arithmetic.
 *
 * ## Failure posture
 *
 * **Never throws.** A booking that could not be filed on the CRM is still
 * a booking — the guest has the slot and the confirmation — so a failure
 * here is logged and reported in the outcome, never raised into the
 * request that took the booking or the webhook that confirmed it.
 */

/** The CRM plugin's id, as `enabledPlugins` and `disabledPlugins` name it. */
const CRM_PLUGIN_ID = 'crm'

export interface CrmBookingRecordInput {
  hostId: string
  /**
   * The owning org, as `getOrgForHost` returns it — the plugin set, the
   * consent groups and the scope default are all read off it.
   */
  org: Record<string, unknown> | null | undefined
  orgId: string
  /** The booking as its row was written. */
  booking: {
    id: string
    serviceId?: string
    serviceName?: string
    email?: string
    startsAtMs: number
    endsAtMs: number
    /** The `crm` query value the link carried, kept on the row. */
    crmRef?: string | null
  }
  /** The service as stored: its two CRM switches and its timezone. */
  service:
    | {
        name?: string
        timezone?: string
        crmFollowUpTask?: boolean
        crmMeetingActivity?: boolean
      }
    | null
    | undefined
  /**
   * The host document's plugin fields, when the caller already holds them;
   * read here otherwise. The deny-list is per site, and a site that has
   * switched the CRM off must file nothing.
   */
  host?: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null
}

export type CrmBookingRecordOutcome =
  | {
      filed: false
      reason:
        /** The CRM plugin does not run on this site. */
        | 'crm-off'
        /**
         * The org's plan does not carry the CRM suite, whose activities and
         * tasks these are (AGL-2787).
         */
        | 'not-entitled'
        /** Neither the reference nor the address named a record. */
        | 'no-record'
        /** A meeting for this booking is already on the timeline. */
        | 'already-filed'
        /** The service asks for neither a meeting nor a follow-up. */
        | 'nothing-to-file'
        /** A read or a write threw; logged, and nothing is promised. */
        | 'failed'
    }
  | {
      filed: true
      /** How the record was found. */
      matchedBy: 'crmRef' | 'email'
      link: CrmActivityLink
      /** The meeting's id, or `null` when the service files no meeting. */
      activityId: string | null
      /** The follow-up's id, or `null` when the service asks for none. */
      taskId: string | null
    }

interface ResolvedRecord {
  link: CrmActivityLink
  matchedBy: 'crmRef' | 'email'
  /** Whoever holds the relationship, for the follow-up's assignee. */
  ownerUid?: string
}

/**
 * The record a booking belongs to — the reference first, the address second.
 */
async function resolveBookingRecord(
  firestore: FirebaseFirestore.Firestore,
  input: CrmBookingRecordInput,
  groupId: string,
): Promise<ResolvedRecord | null> {
  const { hostId, orgId } = input
  const orgRef = firestore.collection('orgs').doc(orgId)
  const contactsRef = orgRef.collection('contacts')
  const ref = parseCrmBookingRef(input.booking.crmRef)
  if (ref?.kind === 'contact') {
    const contact = await contactsRef.doc(ref.id).get()
    if (contact.exists && visibleToHost(contact.get('visibleTo'), hostId)) {
      const facet = readContactFacet(contact.data() ?? {}, groupId)
      return {
        link: {
          contactId: contact.id,
          ...(facet.companyId ? { companyId: facet.companyId } : {}),
        },
        matchedBy: 'crmRef',
        ...(facet.ownerUid ? { ownerUid: facet.ownerUid } : {}),
      }
    }
  }
  if (ref?.kind === 'deal') {
    const deal = await orgRef.collection(CRM_COLLECTIONS.deals).doc(ref.id).get()
    if (deal.exists && visibleToHost(deal.get('visibleTo'), hostId)) {
      const contactId = String(deal.get('contactId') ?? '')
      const companyId = String(deal.get('companyId') ?? '')
      const ownerUid = String(deal.get('ownerUid') ?? '')
      return {
        link: {
          dealId: deal.id,
          ...(contactId ? { contactId } : {}),
          ...(companyId ? { companyId } : {}),
        },
        matchedBy: 'crmRef',
        ...(ownerUid ? { ownerUid } : {}),
      }
    }
  }
  if (ref?.kind === 'lead') {
    // A lead is host-scoped by path and carries no `visibleTo` of its own.
    const lead = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('leads')
      .doc(ref.id)
      .get()
    if (lead.exists) {
      const ownerUid = String(lead.get('ownerUid') ?? '')
      return {
        link: { leadId: lead.id },
        matchedBy: 'crmRef',
        ...(ownerUid ? { ownerUid } : {}),
      }
    }
  }
  const hit = await findContactByEmail(contactsRef, input.booking.email, { hostId })
  if (!hit) return null
  const facet = readContactFacet(hit.data() ?? {}, groupId)
  return {
    link: {
      contactId: hit.id,
      ...(facet.companyId ? { companyId: facet.companyId } : {}),
    },
    matchedBy: 'email',
    ...(facet.ownerUid ? { ownerUid: facet.ownerUid } : {}),
  }
}

/**
 * Files what a confirmed booking owes the CRM: the meeting, and the
 * follow-up when the service asks for one. See the module comment.
 */
export async function recordCrmBooking(
  firestore: FirebaseFirestore.Firestore,
  input: CrmBookingRecordInput,
): Promise<CrmBookingRecordOutcome> {
  const { hostId, orgId, booking, service } = input
  try {
    if (!hostId || !orgId || !booking?.id) return { filed: false, reason: 'failed' }
    const wantsMeeting = service?.crmMeetingActivity !== false
    const wantsTask = service?.crmFollowUpTask === true
    if (!wantsMeeting && !wantsTask) return { filed: false, reason: 'nothing-to-file' }

    const host =
      input.host === undefined
        ? ((await firestore.collection('hosts').doc(hostId).get()).data() as
            | { disabledPlugins?: string[]; enabledPlugins?: string[] }
            | undefined) ?? null
        : input.host
    if (!isHostPluginEnabled(input.org ?? null, host, CRM_PLUGIN_ID)) {
      return { filed: false, reason: 'crm-off' }
    }
    if (!checkEntitlement(input.org as Parameters<typeof checkEntitlement>[0], 'crm')) {
      return { filed: false, reason: 'not-entitled' }
    }

    const orgRef = firestore.collection('orgs').doc(orgId)
    const activities = orgRef.collection(CRM_COLLECTIONS.activities)
    // One meeting per booking, whatever path re-enters: the paid webhook is
    // redelivered for days after any 500, and its own guard is the status,
    // which this row is not part of.
    const already = await activities.where('bookingId', '==', booking.id).limit(1).get()
    if (!already.empty) return { filed: false, reason: 'already-filed' }

    const group = consentGroupForHost(input.org ?? null, hostId)
    const record = await resolveBookingRecord(firestore, input, group.groupId)
    if (!record) return { filed: false, reason: 'no-record' }

    const visibleTo = crmScopeTokens(input.org ?? null, group)
    const serviceName = String(service?.name ?? booking.serviceName ?? '').trim()
    const timezone = service?.timezone || undefined

    let activityId: string | null = null
    if (wantsMeeting) {
      // The per-record ceiling (AGL-2611): a full log refuses the meeting
      // but not the follow-up — a task is owed either way.
      const logged = await countCrmActivitiesForRecord(orgRef, record.link)
      if (crmActivityLogHasRoom(logged)) {
        const activity: CrmActivity = {
          kind: 'meeting',
          body: crmBookingMeetingBody({
            serviceName,
            startsAtMs: booking.startsAtMs,
            timezone,
          }),
          // When it HAPPENS, which is the slot — not when it was booked.
          atMs: booking.startsAtMs,
          byUid: '',
          ...record.link,
          bookingId: booking.id,
          hostId,
          visibleTo,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }
        const written = await activities.add(activity)
        activityId = written.id
      }
    }

    let taskId: string | null = null
    if (wantsTask) {
      const task: CrmTask = {
        title: crmBookingFollowUpTitle(serviceName),
        kind: 'todo',
        priority: 'normal',
        status: 'open',
        dueAtMs: crmBookingFollowUpDueMs(booking.endsAtMs, timezone),
        ...(record.ownerUid ? { assigneeUid: record.ownerUid } : {}),
        createdByUid: '',
        ...record.link,
        hostId,
        visibleTo,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      const written = await orgRef.collection(CRM_COLLECTIONS.tasks).add(task)
      taskId = written.id
    }

    return { filed: true, matchedBy: record.matchedBy, link: record.link, activityId, taskId }
  } catch (error) {
    console.error('[crm] booking could not be filed', hostId, booking?.id, error)
    return { filed: false, reason: 'failed' }
  }
}
