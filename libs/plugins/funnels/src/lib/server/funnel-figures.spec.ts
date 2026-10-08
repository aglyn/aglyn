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

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

import { FakeFirestore } from '../testing/fake-firestore'
import { funnelFigureReaders } from './funnel-figures'

const NOW = new Date('2026-10-06T12:00:00Z')
const AT = Date.parse('2026-10-05T10:00:00Z')

function db() {
  return new FakeFirestore()
    .seed('hosts/h1/funnels/f1', {
      name: 'Pricing to contact',
      steps: [
        { type: 'page', key: '/pricing', match: 'exact', label: 'Pricing' },
        { type: 'form', key: 'f1', label: 'Contact' },
      ],
    })
    .seed('hosts/h1/funnelJourneys/v1', {
      startedAt: { toMillis: () => AT },
      steps: [{ t: 'page', k: '/pricing', at: AT }, { t: 'form', k: 'f1', at: AT + 90_000 }],
    })
    .seed('hosts/h1/funnelJourneys/v2', {
      startedAt: { toMillis: () => AT + 1 },
      steps: [{ t: 'page', k: '/pricing', at: AT + 1 }],
    })
}

const request = (params: Record<string, string> = {}, days = 7) => ({
  orgId: 'o1',
  hostId: 'h1',
  days,
  now: NOW,
  uid: null,
  params,
})

describe('the funnels figure set (AGL-3605)', () => {
  const store = db()
  const [overview, steps] = funnelFigureReaders(() => store)

  it('is sold under the paid analytics tier and named by the funnels prefix', () => {
    expect([overview.id, steps.id]).toEqual(['funnels.overview', 'funnels.steps'])
    expect(overview.feature).toBe('screenAnalytics')
  })

  it('answers each funnel’s entered, completed and share', async () => {
    const read = await overview.read(request())
    expect(read.ok && read.table.rows).toEqual([
      { funnel: 'Pricing to contact', steps: 2, entered: 2, completed: 1, conversion: 50 },
    ])
  })

  it('answers one funnel step by step, durations in seconds', async () => {
    const read = await steps.read(request({ funnel: 'pricing to contact' }))
    expect(read.ok && read.table.rows).toEqual([
      { step: '1. Pricing', visitors: 2, fromPrevious: null, dropOff: 0, medianTime: null },
      { step: '2. Contact', visitors: 1, fromPrevious: 50, dropOff: 1, medianTime: 90 },
    ])
  })

  it('refuses an unknown funnel, a window it does not cover and no site', async () => {
    expect(await steps.read(request({ funnel: 'nope' }))).toMatchObject({ ok: false, status: 404 })
    expect(await overview.read(request({}, 5))).toMatchObject({ ok: false, status: 400 })
    expect(await overview.read({ ...request(), hostId: null })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('a draft funnel in the figure set (AGL-3616)', () => {
  const store = db().seed('hosts/h1/funnels/d1', {
    name: 'Drafted by a build',
    status: 'draft',
    steps: [
      { type: 'page', key: '/pricing', match: 'exact' },
      { type: 'order', key: '' },
    ],
  })
  const [overview, steps] = funnelFigureReaders(() => store)

  it('is not read until it is activated', async () => {
    const read = await overview.read(request())
    expect(read.ok && read.table.rows.map((row) => row['funnel'])).toEqual(['Pricing to contact'])
    expect(await steps.read(request({ funnel: 'drafted by a build' }))).toMatchObject({ ok: false, status: 404 })
  })
})
