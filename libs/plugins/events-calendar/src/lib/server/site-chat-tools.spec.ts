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

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ firebaseAdmin: { app: jest.fn() } }))

import { upcomingEventsAnswer } from './site-chat-tools'

const at = (iso: string) => Date.parse(iso)
const events = [
  { title: 'Thursday night practice', startsAtMs: at('2026-12-03T23:00:00Z'), endsAtMs: 0, location: 'Main track', description: null },
  { title: 'Winter series race', startsAtMs: at('2026-12-06T15:00:00Z'), endsAtMs: 0, location: null, description: 'Round 1' },
]

describe('events site chat tool (AGL-4250)', () => {
  it('lists what is on in a window, soonest first, as cards with no page of their own', () => {
    const answer = upcomingEventsAnswer(events, {
      fromMs: at('2026-12-05T00:00:00Z'),
      toMs: at('2026-12-06T23:59:59Z'),
      query: '',
      timeZone: 'America/Chicago',
    })
    expect(answer.text).toMatch(/^- Winter series race: Sun, Dec 6/)
    expect(answer.cards).toEqual([expect.objectContaining({ kind: 'event', title: 'Winter series race' })])
  })

  it('narrows by the words the visitor used, and says plainly when nothing matches', () => {
    expect(upcomingEventsAnswer(events, { fromMs: 0, toMs: null, query: 'practice' }).cards).toHaveLength(1)
    expect(upcomingEventsAnswer(events, { fromMs: 0, toMs: null, query: 'concert' }).text).toMatch(/No published events/)
  })
})
