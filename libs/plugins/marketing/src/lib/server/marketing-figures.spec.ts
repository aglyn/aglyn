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

import { marketingFigureReaders } from './marketing-figures'

/**
 * Campaign and A/B testing results as figure tables (AGL-2915): the sends of
 * the window through `campaignReport`, pooled across sends rather than an
 * average of rates, and each test's variants against the first.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')
const sentAt = (daysAgo: number) => ({ toMillis: () => Date.UTC(2026, 8, 16) - daysAgo * 86_400_000 + 3_600_000 })

function firestoreOf(collections: Record<string, Array<{ id: string; data: Record<string, unknown>; stats?: Array<{ id: string; data: Record<string, unknown> }> }>>) {
  const collection = (name: string): any => ({
    orderBy: () => collection(name),
    limit: () => collection(name),
    get: async () => ({
      docs: (collections[name] ?? []).map((entry) => ({
        id: entry.id,
        data: () => entry.data,
        ref: {
          collection: () => ({
            get: async () => ({ docs: (entry.stats ?? []).map((stat) => ({ id: stat.id, data: () => stat.data })) }),
          }),
        },
      })),
    }),
  })
  return { collection: () => ({ doc: () => ({ collection }) }) } as unknown as FirebaseFirestore.Firestore
}

const readerFor = (id: string, firestore: FirebaseFirestore.Firestore) => {
  const reader = marketingFigureReaders(() => firestore).find((entry) => entry.id === id)
  if (!reader) throw new Error(id)
  return reader
}

describe('campaigns', () => {
  it('reads the sends of the window, pooling their rates on the first row', async () => {
    const firestore = firestoreOf({
      campaigns: [
        { id: 'c1', data: { subject: 'Fall sale', sentAt: sentAt(1), stats: { sent: 100, delivered: 100, uniqueOpens: 50, uniqueClicks: 10, htmlPart: true } } },
        { id: 'c2', data: { subject: 'New arrivals', sentAt: sentAt(3), stats: { sent: 300, delivered: 300, uniqueOpens: 60, uniqueClicks: 30, htmlPart: true } } },
        { id: 'c3', data: { subject: 'Old news', sentAt: sentAt(20), stats: { delivered: 50 } } },
        { id: 'c4', data: { subject: 'Draft' } },
      ],
    })
    const read = await readerFor('marketing.campaigns', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows.map((row) => [row['campaign'], row['delivered']])).toEqual([
      ['All campaigns', 400],
      ['Fall sale', 100],
      ['New arrivals', 300],
    ])
    const [all, fall, arrivals] = read.table.rows
    // Pooled: 110 of 400 opened, never the average of 50% and 20%.
    expect(all['openRate']).toBe(27.5)
    expect(fall['openRate']).toBe(50)
    expect(arrivals['openRate']).toBe(20)
  })
})

describe('A/B tests', () => {
  it('reads each running or finished test’s variants against the first', async () => {
    const firestore = firestoreOf({
      experiments: [
        {
          id: 'e1',
          data: { name: 'Hero headline', status: 'running', variants: [{ id: 'a', name: 'Control' }, { id: 'b', name: 'Shorter' }] },
          stats: [
            { id: 'a', data: { exposures: 1_000, conversions: 50 } },
            { id: 'b', data: { exposures: 1_000, conversions: 80 } },
          ],
        },
        { id: 'e2', data: { name: 'Draft test', status: 'draft', variants: [{ id: 'a' }, { id: 'b' }] } },
      ],
    })
    const read = await readerFor('marketing.experiments', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 0,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { test: 'Hero headline', variant: 'Control', shown: 1_000, conversions: 50, rate: 5, lift: null, confidence: null },
      { test: 'Hero headline', variant: 'Shorter', shown: 1_000, conversions: 80, rate: 8, lift: 60, confidence: expect.any(Number) },
    ])
    expect(Number(read.table.rows[1]['confidence'])).toBeGreaterThan(99)
  })
})
