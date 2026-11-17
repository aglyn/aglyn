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
 * The cap's ONE engage write (AGL-4232): a real transaction that re-reads the
 * marker and every grace stamp, grants the one-time grace only when neither
 * the workspace nor any of its sites has had it, stamps a site only with
 * `update` (never recreating a deleted one), and engages only the current
 * month.
 */

import { engageBandwidthCap } from './bandwidth-cap-engage'

type Data = Record<string, unknown>

/** A store with Firestore's transaction semantics that matter here. */
function fakeStore(initial: Record<string, Data>) {
  const docs = new Map(Object.entries(initial).map(([path, data]) => [path, { ...data }]))
  const writes: Array<{ op: string; path: string; data: Data }> = []
  const ref = (path: string): any => ({
    path,
    id: path.split('/').pop(),
    get: async () => snapshot(path),
  })
  const snapshot = (path: string) => ({
    ref: ref(path),
    exists: docs.has(path),
    data: () => docs.get(path),
  })
  const firestore: any = {
    runTransaction: async (body: (tx: any) => Promise<unknown>) => {
      const staged: Array<() => void> = []
      const result = await body({
        get: async (target: any) => snapshot(target.path),
        set: (target: any, data: Data, options?: { merge?: boolean }) => {
          staged.push(() => {
            writes.push({ op: 'set', path: target.path, data })
            docs.set(target.path, options?.merge ? { ...(docs.get(target.path) ?? {}), ...data } : data)
          })
        },
        update: (target: any, data: Data) => {
          staged.push(() => {
            if (!docs.has(target.path)) throw new Error(`no document at ${target.path}`)
            writes.push({ op: 'update', path: target.path, data })
            docs.set(target.path, { ...docs.get(target.path), ...data })
          })
        },
      })
      for (const apply of staged) apply()
      return result
    },
  }
  return { docs, writes, ref, firestore }
}

const NOW = Date.UTC(2026, 10, 17, 12)
const MONTH = '2026-11'
const GRACE = 72 * 60 * 60 * 1000

const engage = (store: ReturnType<typeof fakeStore>, hostPaths: string[], nowMs = NOW, month = MONTH) =>
  engageBandwidthCap({
    firestore: store.firestore,
    orgRef: store.ref('orgs/org-1'),
    hostRefs: hostPaths.map(store.ref),
    month,
    nowMs,
    pageViews: 3000,
    includedPageViews: 2070,
  })

describe('the engage writer (AGL-4232)', () => {
  it('grants the grace the first time: marker, workspace stamp and every site stamp', async () => {
    const store = fakeStore({ 'orgs/org-1': { plan: 'free' }, 'hosts/a': {}, 'hosts/b': {} })
    await expect(engage(store, ['hosts/a', 'hosts/b'])).resolves.toEqual({
      stamped: true,
      graceUntil: NOW + GRACE,
      graceIsNew: true,
    })
    expect(store.docs.get('orgs/org-1')).toMatchObject({
      plan: 'free',
      bandwidthGraceUsedAt: NOW,
      bandwidthCap: { month: MONTH, engagedAt: NOW, graceUntil: NOW + GRACE },
    })
    expect(store.docs.get('hosts/a')).toEqual({ bandwidthGraceUsedAt: NOW })
    expect(store.writes.filter((write) => write.op === 'update').map((write) => write.path)).toEqual([
      'hosts/a',
      'hosts/b',
    ])
  })

  it('a second writer in the same month writes nothing and announces nothing', async () => {
    const store = fakeStore({ 'orgs/org-1': { plan: 'free' }, 'hosts/a': {} })
    await engage(store, ['hosts/a'])
    const before = store.writes.length
    await expect(engage(store, ['hosts/a'], NOW + 1000)).resolves.toEqual({
      stamped: false,
      graceUntil: null,
      graceIsNew: false,
    })
    expect(store.writes).toHaveLength(before)
  })

  it('never recreates a site that does not exist: a missing ref is read and skipped', async () => {
    const store = fakeStore({ 'orgs/org-1': { plan: 'free' }, 'hosts/a': {} })
    await engage(store, ['hosts/a', 'hosts/deleted'])
    expect(store.docs.has('hosts/deleted')).toBe(false)
    expect(store.writes.some((write) => write.path === 'hosts/deleted')).toBe(false)
  })

  it('one write per site when the caller seeds its own site twice (a legacy site)', async () => {
    const store = fakeStore({ 'orgs/org-1': { plan: 'free' }, 'hosts/legacy': {} })
    await engage(store, ['hosts/legacy', 'hosts/legacy'])
    expect(store.writes.filter((write) => write.path === 'hosts/legacy')).toHaveLength(1)
    expect(store.docs.get('hosts/legacy')).toEqual({ bandwidthGraceUsedAt: NOW })
  })

  it('the workspace stamp alone denies a new grant: a new site after a deleted one pauses', async () => {
    const store = fakeStore({
      'orgs/org-1': { plan: 'free', bandwidthGraceUsedAt: NOW - 40 * 86_400_000 },
      'hosts/new': {},
    })
    await expect(engage(store, ['hosts/new'])).resolves.toEqual({
      stamped: true,
      graceUntil: null,
      graceIsNew: false,
    })
    expect(store.docs.get('hosts/new')).toEqual({})
  })

  it('a grace granted late last month runs on into this one, said as carried', async () => {
    const grantedAt = Date.UTC(2026, 9, 30, 12)
    const store = fakeStore({
      'orgs/org-1': { plan: 'free', bandwidthGraceUsedAt: grantedAt },
      'hosts/a': { bandwidthGraceUsedAt: grantedAt },
    })
    await expect(engage(store, ['hosts/a'], Date.UTC(2026, 10, 1, 6))).resolves.toEqual({
      stamped: true,
      graceUntil: grantedAt + GRACE,
      graceIsNew: false,
    })
  })

  it('engages only the CURRENT month: a sweep that froze its month before midnight spends nothing', async () => {
    const store = fakeStore({ 'orgs/org-1': { plan: 'free' }, 'hosts/a': {} })
    // The month is October, the clock already says November 1.
    await expect(engage(store, ['hosts/a'], Date.UTC(2026, 10, 1, 0, 5), '2026-10')).resolves.toEqual({
      stamped: false,
      graceUntil: null,
      graceIsNew: false,
    })
    expect(store.writes).toHaveLength(0)
  })
})
