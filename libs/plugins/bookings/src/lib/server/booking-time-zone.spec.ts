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

let orgZone: string | undefined
jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: async () => ({ org: orgZone ? { timeZone: orgZone } : {} }),
}))

import { bookingTimeZoneFor } from './booking-time-zone'

const docs = new Map<string, Record<string, unknown>>()
let reads = 0

function docRef(path: string): any {
  return {
    get: async () => {
      reads += 1
      return { data: () => docs.get(path) }
    },
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
  }
}

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
} as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  docs.clear()
  reads = 0
  orgZone = undefined
})

describe('the zone of a stored booking (AGL-3432)', () => {
  it('is the zone the booking stored, with no reads', async () => {
    docs.set('hosts/h1/services/s1', { timezone: 'Europe/Berlin' })
    expect(
      await bookingTimeZoneFor(firestore, 'h1', {
        timezone: 'America/Chicago',
        serviceId: 's1',
      }),
    ).toBe('America/Chicago')
    expect(reads).toBe(0)
  })

  it('for a booking that stored none, is its service’s, then the site’s, then the workspace’s', async () => {
    docs.set('hosts/h1/services/s1', { timezone: 'Europe/Berlin' })
    expect(await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' })).toBe(
      'Europe/Berlin',
    )

    docs.set('hosts/h1/services/s1', {})
    docs.set('hosts/h1', { timeZone: 'America/New_York' })
    expect(await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' })).toBe(
      'America/New_York',
    )

    docs.set('hosts/h1', {})
    orgZone = 'Asia/Tokyo'
    expect(await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' })).toBe(
      'Asia/Tokyo',
    )
  })

  it('is UTC when nothing names one, or when a read fails', async () => {
    expect(await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' })).toBe(
      'UTC',
    )
    const broken = {
      collection: () => {
        throw new Error('unavailable')
      },
    } as unknown as FirebaseFirestore.Firestore
    expect(await bookingTimeZoneFor(broken, 'h1', { serviceId: 's1' })).toBe(
      'UTC',
    )
  })

  it('resolves each service once for a batch that shares a cache', async () => {
    docs.set('hosts/h1/services/s1', { timezone: 'Europe/Berlin' })
    const cache = new Map<string, Promise<string>>()
    await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' }, cache)
    const after = reads
    await bookingTimeZoneFor(firestore, 'h1', { serviceId: 's1' }, cache)
    expect(reads).toBe(after)
  })
})
