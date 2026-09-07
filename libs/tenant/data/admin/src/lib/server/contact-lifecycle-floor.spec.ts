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

/**
 * The stage floor over a held contact (AGL-2641).
 *
 * Four contracts: the floor FILLS an absent stage and ADVANCES an earlier
 * one, inside the named site's facet and nowhere else; it never DEMOTES —
 * a customer, an evangelist and `other` are left as they are, with no
 * write at all; the holder falls back to the person's own capturing site
 * when the caller names none, and is refused when neither names one; and
 * a missing document is reported, not written.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))

import { floorContactLifecycleStage } from './contact-lifecycle-floor'

const updates: Array<Record<string, unknown>> = []

function contactRef(id: string, data: Record<string, unknown> | null): any {
  const ref = {
    id,
    get: async () => ({
      id,
      exists: data !== null,
      data: () => data ?? undefined,
      ref,
    }),
    update: async (patch: Record<string, unknown>) => {
      updates.push(patch)
    },
  }
  return ref
}

/** An org with the two sites pooled as one sender, and a third alone. */
const ORG = {
  hosts: { shop: true, cafe: true, studio: true },
  consentGroups: { retail: { name: 'Retail', hostIds: ['shop', 'cafe'] } },
}

const person = (stage?: string, hostId = 'shop', groupId = 'retail') => ({
  email: 'maya@example.com',
  hostId,
  facets: {
    [groupId]: {
      sources: { form: true },
      interactions: [],
      ...(stage ? { lifecycleStage: stage } : {}),
    },
  },
})

beforeEach(() => {
  updates.length = 0
})

describe('floorContactLifecycleStage (AGL-2641)', () => {
  it('fills an absent stage, writing the named site’s facet through its consent group', async () => {
    const result = await floorContactLifecycleStage({
      contactRef: contactRef('c1', person()),
      org: ORG,
      hostId: 'cafe',
      floor: 'customer',
    })
    expect(result).toEqual({
      outcome: 'advanced',
      contactId: 'c1',
      email: 'maya@example.com',
      hostId: 'cafe',
      groupId: 'retail',
      previousStage: '',
      lifecycleStage: 'customer',
    })
    expect(updates).toEqual([
      { 'facets.retail.lifecycleStage': 'customer', updatedAt: 'server-timestamp' },
    ])
  })

  it('advances an earlier stage and reports the one it replaced', async () => {
    const result = await floorContactLifecycleStage({
      contactRef: contactRef('c1', person('sales-qualified')),
      org: ORG,
      hostId: 'shop',
      floor: 'customer',
    })
    expect(result).toMatchObject({
      outcome: 'advanced',
      previousStage: 'sales-qualified',
      lifecycleStage: 'customer',
    })
    expect(updates).toHaveLength(1)
  })

  it.each(['customer', 'evangelist', 'other'])(
    'holds a person already at %s, writing nothing',
    async (stage) => {
      const result = await floorContactLifecycleStage({
        contactRef: contactRef('c1', person(stage)),
        org: ORG,
        hostId: 'shop',
        floor: 'customer',
      })
      expect(result).toEqual({
        outcome: 'held',
        contactId: 'c1',
        email: 'maya@example.com',
        hostId: 'shop',
        groupId: 'retail',
        lifecycleStage: stage,
      })
      expect(updates).toEqual([])
    },
  )

  it('writes only the named site’s facet — another holder’s stage is not consulted', async () => {
    // The studio holds the person as a lead; the retail group has no facet yet.
    const result = await floorContactLifecycleStage({
      contactRef: contactRef('c1', person('customer', 'studio', 'studio')),
      org: ORG,
      hostId: 'shop',
      floor: 'customer',
    })
    expect(result).toMatchObject({ outcome: 'advanced', groupId: 'retail', previousStage: '' })
    expect(updates[0]).toHaveProperty(['facets.retail.lifecycleStage'], 'customer')
  })

  it('falls back to the person’s own capturing site when the caller names none', async () => {
    const result = await floorContactLifecycleStage({
      contactRef: contactRef('c1', person('lead', 'studio', 'studio')),
      org: ORG,
      hostId: null,
      floor: 'customer',
    })
    expect(result).toMatchObject({
      outcome: 'advanced',
      hostId: 'studio',
      groupId: 'studio',
      previousStage: 'lead',
    })
    expect(updates[0]).toHaveProperty(['facets.studio.lifecycleStage'], 'customer')
  })

  it('refuses a person nobody holds, and reports a missing document, writing nothing', async () => {
    const unheld = await floorContactLifecycleStage({
      contactRef: contactRef('c1', { email: 'x@example.com' }),
      org: ORG,
      hostId: '',
      floor: 'customer',
    })
    expect(unheld).toEqual({ outcome: 'unheld', contactId: 'c1' })
    const missing = await floorContactLifecycleStage({
      contactRef: contactRef('gone', null),
      org: ORG,
      hostId: 'shop',
      floor: 'customer',
    })
    expect(missing).toEqual({ outcome: 'missing', contactId: 'gone' })
    expect(updates).toEqual([])
  })
})
