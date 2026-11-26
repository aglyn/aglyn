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

import type { PluginApiHandler } from '@aglyn/aglyn/app-utils/api-plugins'
import { createBookingsSiteChatRunners } from './site-chat-tools'

const SLOT = Date.parse('2026-12-05T16:00:00Z')

/** The slot door, as the widget sees it: services, then one service's times. */
const slots: PluginApiHandler = async (req, res) => {
  if (!req.query['serviceId']) {
    return res.status(200).json({
      services: [
        { $id: 'svc-lesson', name: 'Beginner group lesson', durationMinutes: 90, priceUsd: 175, description: 'Bike included' },
        { $id: 'svc-free', name: 'Track walk', durationMinutes: 30, priceUsd: 0 },
      ],
    })
  }
  return res.status(200).json({ service: { timezone: 'America/Chicago' }, slots: [{ startsAtMs: SLOT }] })
}

const runners = createBookingsSiteChatRunners(slots)

describe('bookings site chat tools (AGL-4250)', () => {
  it('lists the services the widget offers', async () => {
    const answer = await runners.listServices({ hostId: 'h', input: {} })
    expect(answer.text).toContain('Beginner group lesson: 90 minutes, $175')
    expect(answer.text).toContain('Track walk: 30 minutes, free')
  })

  it('offers the open times of the service named, from the slot door', async () => {
    const answer = await runners.openTimes({ hostId: 'h', input: { service: 'group lesson', day: '' } })
    expect(answer.text).toContain(`[startsAt ${new Date(SLOT).toISOString()}]`)
  })

  it('proposes a booking only for an open time, posting to the booking door with the visitor\'s own details', async () => {
    const answer = await runners.proposeBooking({
      hostId: 'h',
      input: { service: 'Beginner group lesson', startsAt: new Date(SLOT).toISOString() },
    })
    expect(answer.proposal).toMatchObject({
      kind: 'book',
      confirmLabel: 'Book and pay',
      request: { path: 'bookings/book', body: { hostId: 'h', serviceId: 'svc-lesson', startsAtMs: SLOT } },
    })
    expect(answer.proposal?.fields?.map((field) => field.name)).toEqual(['name', 'email'])
    const taken = await runners.proposeBooking({ hostId: 'h', input: { service: 'Track walk', startsAt: '2026-12-05T18:00:00Z' } })
    expect(taken.proposal).toBeUndefined()
  })

  it('never books a free service by itself: it too is a card the visitor presses', async () => {
    const answer = await runners.proposeBooking({ hostId: 'h', input: { service: 'Track walk', startsAt: new Date(SLOT).toISOString() } })
    expect(answer.proposal).toMatchObject({ kind: 'book', confirmLabel: 'Book' })
  })
})
