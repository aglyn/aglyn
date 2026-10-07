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

import { normalizePluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { overlayFigureReader } from './overlay-figures'

/**
 * A site's overlays as a figure table (AGL-3603): the lifetime counters the
 * beacon increments, per overlay in the list's order and in total, with
 * nothing of an overlay's copy or pages in the table.
 */

const NOW = new Date('2026-10-06T15:00:00.000Z')

type Doc = Record<string, unknown>

function firestoreOf(overlays: Doc[]) {
  const selected: string[][] = []
  const query: any = {
    select: (...fields: string[]) => {
      selected.push(fields)
      return query
    },
    limit: () => query,
    get: async () => ({ docs: overlays.map((data, index) => ({ id: `o${index}`, data: () => data })) }),
  }
  const firestore = {
    collection: () => ({ doc: () => ({ collection: () => query }) }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, selected }
}

const request = (hostId: string | null) => ({ orgId: 'org-1', hostId, days: 0, now: NOW, uid: null, params: {} })

describe('overlay figures', () => {
  it('totals and lists each overlay’s views, clicks and dismissals, in the list’s order', async () => {
    const { firestore, selected } = firestoreOf([
      {
        kind: 'popup',
        name: 'Spring sale',
        enabled: true,
        order: 1,
        popup: { title: 'Call 555-0100 for 20% off' },
        stats: { impressions: 400, clicks: 20, dismissals: 300 },
      },
      { kind: 'bar', name: 'Free shipping', enabled: false, order: 0, stats: { impressions: 1000, clicks: 50 } },
      { kind: 'bar', enabled: true, order: 2, endAtMs: NOW.getTime() - 1 },
    ])
    const read = await overlayFigureReader(() => firestore).read(request('host-1'))
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { overlay: 'All overlays', kind: 'All kinds', status: 'All statuses', views: 1400, clicks: 70, clickRate: 5, dismissals: 300 },
      { overlay: 'Free shipping', kind: 'Announcement bar', status: 'Off', views: 1000, clicks: 50, clickRate: 5, dismissals: 0 },
      { overlay: 'Spring sale', kind: 'Popup', status: 'Showing', views: 400, clicks: 20, clickRate: 5, dismissals: 300 },
      { overlay: 'Untitled announcement bar', kind: 'Announcement bar', status: 'Scheduled', views: 0, clicks: 0, clickRate: null, dismissals: 0 },
    ])
    expect(read.table.period).toBeNull()
    // The copy is never read, and never reaches the table.
    expect(selected[0]).not.toContain('popup')
    expect(JSON.stringify(read.table)).not.toMatch(/555|20% off/)
    expect(normalizePluginFigureTable(read.table)).not.toBeNull()
  })

  it('reads only when a site is named', async () => {
    const reader = overlayFigureReader(() => firestoreOf([]).firestore)
    expect(await reader.read(request(null))).toMatchObject({ ok: false, status: 400 })
  })
})
