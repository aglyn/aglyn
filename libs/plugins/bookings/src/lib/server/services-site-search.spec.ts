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

/** A site's booking services in site search, and as a "Book" offer (AGL-4252). */

let flagOn = true
const services: Record<string, Record<string, unknown>> = {
  lesson: {
    name: 'Private lesson',
    description: 'One hour with a coach.',
    durationMinutes: 60,
    priceUsd: 85,
  },
  hidden: { name: 'Draft service', status: 'draft' },
  gone: { name: 'Old', deletedAt: 1 },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              limit: () => ({
                get: async () => ({
                  docs: Object.entries(services).map(([id, data]) => ({
                    id,
                    data: () => data,
                  })),
                }),
              }),
              doc: (id: string) => ({
                get: async () => ({ data: () => services[id] }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: { entitlements: { features: { bookings: true } } },
  }),
  getPluginConfig: async () => ({ bookingPath: 'book/' }),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForLoadedOrg: async () => flagOn,
}))

import {
  bookingsServiceSiteOffer,
  bookingsServicesSiteSearch,
  serviceBookingHref,
} from './services-site-search'

beforeEach(() => {
  flagOn = true
})

describe('services in site search', () => {
  it('lists offered services, linked to the booking page on each', async () => {
    const items = await bookingsServicesSiteSearch.items({
      hostId: 'host-1',
      query: 'lesson',
      limit: 10,
    })
    expect(items).toEqual([
      {
        title: 'Private lesson',
        terms: ['One hour with a coach.'],
        url: '/book?service=lesson',
        snippet: 'One hour with a coach.',
        caption: '60 min · $85',
      },
    ])
  })

  it('lists nothing where the flag is off', async () => {
    flagOn = false
    expect(
      await bookingsServicesSiteSearch.items({
        hostId: 'host-1',
        query: 'x',
        limit: 10,
      }),
    ).toEqual([])
  })
})

describe('a service as a Book button', () => {
  it('opens the booking page on the service', async () => {
    expect(
      await bookingsServiceSiteOffer.resolve({
        hostId: 'host-1',
        id: 'lesson',
      }),
    ).toEqual({
      title: 'Private lesson',
      caption: '$85',
      action: { kind: 'link', href: '/book?service=lesson' },
    })
    expect(
      await bookingsServiceSiteOffer.resolve({
        hostId: 'host-1',
        id: 'hidden',
      }),
    ).toBeNull()
  })

  it('builds the root link when no booking page is set', () => {
    expect(serviceBookingHref(undefined, 'a b')).toBe('/?service=a+b')
  })
})
