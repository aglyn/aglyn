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
  PLUGIN_FIGURE_MAX_ROWS,
  pluginFigureChange,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A site's bookings as a figure table another plugin reads by id (AGL-2915).
 *
 * Counted by service: how many were booked in the window, how many of those
 * were canceled, and the change in bookings from the window before. A booking
 * names a person and says where they will be and when, so nothing of one
 * reaches a table but its service and its status.
 */

type Firestore = FirebaseFirestore.Firestore

/** Bookings one window reads; a busier site is told its figures read low. */
export const BOOKING_FIGURES_WINDOW_CEILING = 1_000

const WINDOWS: readonly number[] = [7, 14, 30, 90]

/** A payment hold that lapsed never became a booking, and is not counted as one. */
const NOT_BOOKED = new Set(['canceled', 'pendingPayment'])

interface ServiceCounts {
  booked: number
  canceled: number
}

async function bookingsBetween(
  firestore: Firestore,
  hostId: string,
  startMs: number,
  endMs: number,
): Promise<{ counts: Map<string, ServiceCounts>; truncated: boolean }> {
  // `createdAt` is stamped by the server on every booking the book route writes.
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('bookings')
    .where('createdAt', '>=', new Date(startMs))
    .where('createdAt', '<', new Date(endMs))
    .orderBy('createdAt', 'desc')
    .limit(BOOKING_FIGURES_WINDOW_CEILING + 1)
    .get()
  const counts = new Map<string, ServiceCounts>()
  for (const doc of snapshot.docs.slice(0, BOOKING_FIGURES_WINDOW_CEILING)) {
    const data = doc.data() ?? {}
    const service = String(data['serviceName'] ?? '').trim() || 'A service with no name'
    const status = String(data['status'] ?? '')
    const entry = counts.get(service) ?? { booked: 0, canceled: 0 }
    if (status === 'canceled') entry.canceled += 1
    if (!NOT_BOOKED.has(status)) entry.booked += 1
    counts.set(service, entry)
  }
  return { counts, truncated: snapshot.docs.length > BOOKING_FIGURES_WINDOW_CEILING }
}

export function bookingFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'bookings.services',
    label: 'Bookings',
    description:
      'Bookings made on the site over the window, by service: how many were booked, how many were canceled, and the change in bookings from the window before.',
    scope: 'site',
    windows: WINDOWS,
    feature: 'bookings',
    read: async (request) => {
      if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its bookings' }
      if (!WINDOWS.includes(request.days)) {
        return { ok: false, status: 400, error: 'That window is not one bookings are read over' }
      }
      const { current, previous } = pluginFigureWindows(request.now, request.days)
      const [now, before] = await Promise.all([
        bookingsBetween(firestore(), request.hostId, current.startMs, current.endMs),
        bookingsBetween(firestore(), request.hostId, previous.startMs, previous.endMs),
      ])
      const sum = (counts: Map<string, ServiceCounts>, key: keyof ServiceCounts) =>
        [...counts.values()].reduce((total, entry) => total + entry[key], 0)
      const services = [...now.counts.entries()].sort((a, b) => b[1].booked - a[1].booked || a[0].localeCompare(b[0]))
      const rows = [
        {
          service: 'All services',
          booked: sum(now.counts, 'booked'),
          canceled: sum(now.counts, 'canceled'),
          change: pluginFigureChange(sum(now.counts, 'booked'), sum(before.counts, 'booked')),
        },
        ...services.slice(0, PLUGIN_FIGURE_MAX_ROWS - 1).map(([service, counts]) => ({
          service,
          booked: counts.booked,
          canceled: counts.canceled,
          change: pluginFigureChange(counts.booked, before.counts.get(service)?.booked ?? null),
        })),
      ]
      return {
        ok: true,
        table: {
          title: 'Bookings',
          source: { label: 'Bookings', path: 'bookings' },
          period: { from: current.from, to: current.to, days: request.days },
          columns: [
            { key: 'service', label: 'Service', kind: 'text' },
            { key: 'booked', label: 'Booked', kind: 'count' },
            { key: 'canceled', label: 'Canceled', kind: 'count' },
            { key: 'change', label: 'Change in bookings', kind: 'change' },
          ],
          rows,
          omitted: Math.max(0, services.length - (PLUGIN_FIGURE_MAX_ROWS - 1)),
          notes: [
            'A booking is counted in the window it was made in, not the day it is for.',
            ...(now.truncated || before.truncated
              ? [
                  `More than ${BOOKING_FIGURES_WINDOW_CEILING.toLocaleString('en-US')} bookings were made in a window, so the figures count the most recent ${BOOKING_FIGURES_WINDOW_CEILING.toLocaleString('en-US')} and read low.`,
                ]
              : []),
          ],
        },
      }
    },
  }
}

/** Registers the bookings reader from the console surface, where insight jobs run. */
export function registerBookingFigureReader(firestore: () => Firestore): void {
  registerPluginFigureReader(bookingFigureReader(firestore), { pluginId: BUNDLE_ID })
}
