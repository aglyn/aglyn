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
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  pluginRecordTimelineWriter,
  type PluginRecordWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  bookingFollowUpDueMs,
  bookingFollowUpTitle,
  bookingMeetingBody,
  parseBookingRecordRef,
} from '../model/booking-record'
import type { HostBookingService } from '../model'

/** What became of a booking's filing on the workspace's records. */
export type BookingRecordOutcome =
  | {
      filed: false
      reason:
        /** No plugin keeps records for this workspace. */
        | 'no-record-system'
        /** The plugin that keeps records does not run on this site. */
        | 'record-system-off'
        /** The service asks for neither a meeting nor a follow-up. */
        | 'nothing-to-file'
        /** A read threw before anything was asked; logged. */
        | 'failed'
    }
  | {
      filed: true
      /** The record system's answer for the meeting, or `null` when none was asked for. */
      meeting: PluginRecordWrite | null
      /** Its answer for the follow-up, or `null` when the service asks for none. */
      followUp: PluginRecordWrite | null
    }

/**
 * THE BOOKING'S WAY BACK TO THE RECORD IT CAME FROM (AGL-2660).
 *
 * Two doors write a confirmed booking: the create route, for a free
 * service, and the payment webhook, for a paid one once the charge clears.
 * Both call this with what they hold — the row as written and, when they
 * already read it, the service — and it files what the service asks for on
 * the workspace's records, through the core's record-timeline seam:
 *
 *  - a `meeting` entry at the slot, naming the service and the time in the
 *    service's own zone, unless the service switched it off;
 *  - a follow-up task one business day after the slot, for whoever holds
 *    the record, when the service asks for one.
 *
 * The record is the record system's to find: the one the booking link was
 * dropped from (`crmRef`, carried back as it was handed over), otherwise the
 * person at the booker's address, as this site sees them. Both entries are
 * keyed by the booking, so the webhook's redeliveries and a second door file
 * nothing twice; a full activity log refuses the meeting and still takes the
 * follow-up. Nothing is filed on a site that has switched the record system
 * off, and the record system refuses a plan without it.
 *
 * **Never throws**: the guest has their slot whatever the record system did,
 * so a failure here is an outcome the caller may log, never an error into
 * the request or the webhook.
 */
export async function fileBookingOnCrm(
  firestore: FirebaseFirestore.Firestore,
  input: {
    hostId: string
    bookingId: string
    /** The booking row as written — or as read back by the webhook. */
    booking: Record<string, unknown>
    /** The service, when the caller already read it. Read here otherwise. */
    service?: HostBookingService | null
  },
): Promise<BookingRecordOutcome> {
  const { hostId, bookingId, booking } = input
  try {
    const records = pluginRecordTimelineWriter()
    if (!records) return { filed: false, reason: 'no-record-system' }
    const owner = await getOrgForHost(hostId)
    if (!owner?.orgId) return { filed: false, reason: 'failed' }
    const hostRef = firestore.collection('hosts').doc(hostId)
    const host = (await hostRef.get()).data() as
      | { disabledPlugins?: string[]; enabledPlugins?: string[] }
      | undefined
    if (!isHostPluginEnabled(owner.org as never, host ?? null, records.pluginId)) {
      return { filed: false, reason: 'record-system-off' }
    }
    const serviceId = String(booking['serviceId'] ?? '')
    const service =
      input.service !== undefined
        ? input.service
        : serviceId
          ? ((await hostRef.collection('services').doc(serviceId).get()).data() as
              | HostBookingService
              | undefined) ?? null
          : null
    const wantsMeeting = service?.crmMeetingActivity !== false
    const wantsFollowUp = service?.crmFollowUpTask === true
    if (!wantsMeeting && !wantsFollowUp) return { filed: false, reason: 'nothing-to-file' }

    const serviceName = String(service?.name ?? booking['serviceName'] ?? '').trim()
    const timezone = service?.timezone || undefined
    const startsAtMs = Number(booking['startsAtMs'] ?? 0)
    const endsAtMs = Number(booking['endsAtMs'] ?? 0)
    const context = {
      orgId: owner.orgId,
      hostId,
      link: {
        record: parseBookingRecordRef(booking['crmRef']),
        email: String(booking['email'] ?? ''),
      },
      sourcePluginId: BUNDLE_ID,
    }

    const meeting = wantsMeeting
      ? await records.writer.logActivity({
          ...context,
          kind: 'meeting',
          // When it HAPPENS, which is the slot — not when it was booked.
          atMs: startsAtMs,
          body: bookingMeetingBody({
            serviceName,
            startsAtMs,
            timezone,
            // What the service asked the booker for (AGL-3493).
            phone: booking['phone'],
            address: booking['address'],
          }),
          byUid: '',
          dedupeKey: `booking:${bookingId}`,
        })
      : null
    const followUp = wantsFollowUp
      ? await records.writer.createTask({
          ...context,
          dedupeKey: `booking-follow-up:${bookingId}`,
          title: bookingFollowUpTitle(serviceName),
          kind: 'todo',
          dueAtMs: bookingFollowUpDueMs(endsAtMs, timezone),
          // Whoever holds the record the booking lands on.
          assigneeUid: null,
          createdByUid: '',
        })
      : null
    return { filed: true, meeting, followUp }
  } catch (error) {
    console.error('[bookings] the booking could not be filed on its record', hostId, bookingId, error)
    return { filed: false, reason: 'failed' }
  }
}
