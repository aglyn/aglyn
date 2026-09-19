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
 * The refusal counter (AGL-2930) has two properties that matter more than
 * its arithmetic: it lands on the month document the spend already lives on,
 * and it can never make a refusal fail. Both are asserted here; the counts
 * reader's zero-fill is the third, because a sparse map is what every reader
 * would otherwise have to guard against.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
  },
}))

import {
  assistRefusalCounts,
  recordAssistRefusal,
} from './assist-refusals'

describe('recordAssistRefusal (AGL-2930)', () => {
  it('increments refusals.{reason} on the month document, merging', async () => {
    const writes: Array<{ path: string; data: unknown; options: unknown }> = []
    const firestore = {
      collection: (name: string) => ({
        doc: (orgId: string) => ({
          collection: (sub: string) => ({
            doc: (month: string) => ({
              set: async (data: unknown, options: unknown) => {
                writes.push({ path: `${name}/${orgId}/${sub}/${month}`, data, options })
              },
            }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore

    recordAssistRefusal(firestore, 'org-1', '2026-09', 'cap')
    await Promise.resolve()

    expect(writes).toEqual([
      {
        path: 'orgs/org-1/assistUsage/2026-09',
        data: { month: '2026-09', refusals: { cap: { __increment: 1 } } },
        options: { merge: true },
      },
    ])
  })

  it('never throws — a double without `set`, or a rejected write', async () => {
    const noSet = {
      collection: () => ({
        doc: () => ({ collection: () => ({ doc: () => ({}) }) }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(() => recordAssistRefusal(noSet, 'org-1', '2026-09', 'band')).not.toThrow()

    const rejecting = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({ set: () => Promise.reject(new Error('offline')) }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(() =>
      recordAssistRefusal(rejecting, 'org-1', '2026-09', 'messages'),
    ).not.toThrow()
    // Let the rejection settle; an unhandled rejection would fail the suite.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('assistRefusalCounts', () => {
  it('zero-fills every reason and totals them', () => {
    expect(assistRefusalCounts({ cap: 12, band: 3 })).toEqual({
      band: 3,
      cap: 12,
      messages: 0,
      // A hard allotment a manager set (AGL-2942).
      allotment: 0,
      budget: 0,
      account: 0,
      requests: 0,
      refusals: 0,
      platform: 0,
      total: 15,
    })
  })

  it('reads an absent map, and a hand-edited value, as zero', () => {
    expect(assistRefusalCounts(undefined).total).toBe(0)
    expect(assistRefusalCounts({ band: 'many', cap: -4, budget: 2.9 })).toEqual({
      band: 0,
      cap: 0,
      messages: 0,
      allotment: 0,
      budget: 2,
      account: 0,
      requests: 0,
      refusals: 0,
      platform: 0,
      total: 2,
    })
  })
})
