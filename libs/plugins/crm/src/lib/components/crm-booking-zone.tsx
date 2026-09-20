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

'use client'

import {
  type AglynOrgBilling,
  checkEntitlement,
  type CrmBookingRefKind,
  isHostPluginEnabled,
} from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

/**
 * "Book a meeting", drawn by whichever plugin takes bookings.
 *
 * A record's header and the one-to-one composer each have a place for it. The
 * CRM keeps the person; the services a site offers, the page they are booked
 * on and the link a visitor follows are the booking plugin's, and the CRM used
 * to import that plugin's model to build the link itself. It hosts this zone
 * instead and hands it the record, and a plugin that takes bookings draws its
 * own control — or, where none runs on the site, nothing at all.
 */
export interface CrmRecordBookingZoneProps {
  /**
   * The site whose services are offered — the mounted site, or at the
   * organization level the record's own capturing site; `null` for a record
   * no site has captured, which offers nothing.
   */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  /** The record the link is dropped from. */
  kind: CrmBookingRefKind
  recordId: string
  /**
   * When given, the widget also offers to insert a link, and hands the chosen
   * one here — the composer's use.
   */
  onInsert?: (link: string) => void
  /** `chip` is the compact form the composer carries beside its fields. */
  variant?: 'button' | 'chip'
}

export const CRM_RECORD_BOOKING_ZONE =
  definePluginZone<CrmRecordBookingZoneProps>('crmRecordBooking')

/** One control among the host's own: the zone is `bare`, so no wrapper. */
export function CrmRecordBookingZone(props: CrmRecordBookingZoneProps) {
  const Slot = useConsoleWidgetSlot()
  if (!Slot) return null
  return <Slot slot={CRM_RECORD_BOOKING_ZONE.id} {...props} />
}
CrmRecordBookingZone.displayName = 'CrmRecordBookingZone'

/** The booking plugin's id, as `enabledPlugins` and `disabledPlugins` name it. */
const BOOKINGS_PLUGIN_ID = 'bookings'

/**
 * Whether this site takes bookings, for the contact page's link to the
 * person's bookings: the plugin runs on the site and the org holds the
 * entitlement. The control in the zone above asks the same of itself; this is
 * the CRM's own question, about a link it draws.
 */
export function useBookingDoor(
  hostId: string | null | undefined,
  org?: Partial<AglynOrgBilling> | null,
): { open: boolean } {
  const firestore = useFirestore()
  const { data: host, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  return {
    open:
      Boolean(hostId) &&
      status === 'success' &&
      Boolean(host) &&
      isHostPluginEnabled(org ?? null, host as never, BOOKINGS_PLUGIN_ID) &&
      checkEntitlement(org ?? null, 'bookings'),
  }
}
