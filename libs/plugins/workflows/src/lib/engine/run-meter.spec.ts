/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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
 * THE RUN METERS (AGL-3472): one band for the workspace, counted on every
 * site's runs.
 *
 * The run paths that use these — events, a page's dispatch, inbound hooks,
 * resumes — are held to it in their own suites (`run-event-actions-org`,
 * `run-event-actions-single-outcome`, `inbound-hook-run-cap`). This one pins
 * the meter itself: what the gate reads, how the workspace's counter is
 * seeded mid-month without counting a run twice, and that a site with no
 * workspace keeps the figure it always had.
 */

const MONTH = '2026-10'
const ORG = 'org-1'

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
/** How many times the sites were listed, and how many batches committed. */
let sitesListed = 0
let batchesCommitted = 0

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}))

const applyPatch = (
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && '__increment' in value
        ? Number(existing[key] ?? 0) + value.__increment
        : value
  }
  return next
}

const snapshotOf = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  exists: store[path] !== undefined,
  get: (field: string) => store[path]?.[field],
  ref: docRef(path),
})

function docRef(path: string): any {
  return {
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      store[path] = applyPatch(options?.merge ? (store[path] ?? {}) : {}, data)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, _op: '==', value: unknown) => ({
      get: async () => {
        sitesListed += 1
        return {
          docs: Object.keys(store)
            .filter(
              (key) =>
                key.startsWith(`${path}/`) &&
                !key.slice(path.length + 1).includes('/') &&
                store[key]?.[field] === value,
            )
            .map(snapshotOf),
        }
      },
    }),
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    return {
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      commit: async () => {
        batchesCommitted += 1
        for (const write of writes) await write()
      },
    }
  },
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    await body({
      get: async (ref: any) => await ref.get(),
      getAll: async (...refs: any[]) =>
        await Promise.all(refs.map((ref) => ref.get())),
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        void ref.set(data, options)
      },
    }),
}

import {
  recordRuns,
  type RunCounter,
  runMonthKey,
  runsUsedThisMonth,
} from './run-meter'

const site = (hostId: string, orgId?: string) => {
  store[`hosts/${hostId}`] = orgId ? { orgId } : {}
  return firestore.collection('hosts').doc(hostId)
}
const scope = (
  hostId: string,
  orgId: string | null,
  counter: RunCounter = 'workflowRuns',
) => ({
  firestore,
  hostRef: firestore.collection('hosts').doc(hostId),
  orgId,
  counter,
  month: MONTH,
})
const orgRuns = (counter: RunCounter = 'workflowRuns') =>
  store[`orgs/${ORG}/counters/${counter}`]

beforeEach(() => {
  store = {}
  sitesListed = 0
  batchesCommitted = 0
})

describe('runMonthKey', () => {
  it('keys the UTC calendar month every run counter keys by', () => {
    expect(runMonthKey(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10')
    expect(runMonthKey(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11')
  })
})

describe('what the gate reads', () => {
  it('a site in a workspace: every site’s runs, the sibling’s included', async () => {
    site('site-a', ORG)
    site('site-b', ORG)
    store['hosts/site-b/counters/workflowRuns'] = { [MONTH]: 40 }

    // Site A has run nothing, and is still 40 runs into the band.
    expect(await runsUsedThisMonth(scope('site-a', ORG))).toBe(40)
  })

  it('a site with no workspace: its own counter, exactly as before', async () => {
    site('site-a')
    store['hosts/site-a/counters/workflowRuns'] = { [MONTH]: 7 }
    store['hosts/site-b/counters/workflowRuns'] = { [MONTH]: 40 }

    expect(await runsUsedThisMonth(scope('site-a', null))).toBe(7)
    expect(sitesListed).toBe(0)
    expect(orgRuns()).toBeUndefined()
  })
})

describe('seeding the workspace’s counter mid-month', () => {
  it('sums this workspace’s sites for the month, and no other workspace’s', async () => {
    site('site-a', ORG)
    site('site-b', ORG)
    site('site-z', 'org-2')
    store['hosts/site-a/counters/workflowRuns'] = { [MONTH]: 3, '2026-09': 900 }
    store['hosts/site-b/counters/workflowRuns'] = { [MONTH]: 4 }
    store['hosts/site-z/counters/workflowRuns'] = { [MONTH]: 1000 }

    expect(await runsUsedThisMonth(scope('site-a', ORG))).toBe(7)
    expect(orgRuns()).toEqual({ [MONTH]: 7, seededFrom: MONTH })
  })

  it('seeds once: later reads, and later months, read the counter alone', async () => {
    site('site-a', ORG)
    store['hosts/site-a/counters/workflowRuns'] = { [MONTH]: 3 }
    await runsUsedThisMonth(scope('site-a', ORG))
    expect(sitesListed).toBe(1)

    await recordRuns({ ...scope('site-a', ORG), count: 2 })
    expect(await runsUsedThisMonth(scope('site-a', ORG))).toBe(5)
    // Next month: every run since the seed reached the counter, so it is
    // complete without asking the sites again.
    expect(
      await runsUsedThisMonth({ ...scope('site-a', ORG), month: '2026-11' }),
    ).toBe(0)
    expect(sitesListed).toBe(1)
  })

  it('never counts a run twice that reached the counter before the seed', async () => {
    // A resume is counted and never gated, so it can land first: on the
    // site's counter AND the workspace's, which then has no seed marker.
    site('site-a', ORG)
    site('site-b', ORG)
    store['hosts/site-b/counters/workflowRuns'] = { [MONTH]: 10 }
    await recordRuns({ ...scope('site-a', ORG), count: 1 })
    expect(orgRuns()).toEqual({ [MONTH]: 1 })

    // The seed is the sites' sum, which already holds that run.
    expect(await runsUsedThisMonth(scope('site-a', ORG))).toBe(11)
    expect(orgRuns()).toEqual({ [MONTH]: 11, seededFrom: MONTH })
  })

  it('reads a corrupt site counter as no runs, never as headroom', async () => {
    site('site-a', ORG)
    site('site-b', ORG)
    store['hosts/site-a/counters/workflowRuns'] = { [MONTH]: -500 }
    store['hosts/site-b/counters/workflowRuns'] = { [MONTH]: 'x' }
    store['hosts/site-c/counters/workflowRuns'] = { [MONTH]: 9 }
    site('site-c', ORG)

    expect(await runsUsedThisMonth(scope('site-a', ORG))).toBe(9)
  })
})

describe('counting a run', () => {
  it('moves the site’s counter and the workspace’s in one write', async () => {
    site('site-a', ORG)
    await recordRuns({ ...scope('site-a', ORG, 'actionRuns'), count: 3 })

    expect(batchesCommitted).toBe(1)
    expect(store['hosts/site-a/counters/actionRuns']).toEqual({ [MONTH]: 3 })
    expect(orgRuns('actionRuns')).toEqual({ [MONTH]: 3 })
  })

  it('a site with no workspace counts on its own counter alone', async () => {
    site('site-a')
    await recordRuns({ ...scope('site-a', null), count: 1 })

    expect(batchesCommitted).toBe(0)
    expect(store['hosts/site-a/counters/workflowRuns']).toEqual({ [MONTH]: 1 })
    expect(orgRuns()).toBeUndefined()
  })

  it('writes nothing when nothing ran', async () => {
    await recordRuns({ ...scope('site-a', ORG), count: 0 })
    expect(store).toEqual({})
  })

  it('never throws into the request that set the run off', async () => {
    const failing = {
      ...firestore,
      batch: () => ({
        set: () => undefined,
        commit: async () => {
          throw new Error('unavailable')
        },
      }),
    }
    await expect(
      recordRuns({ ...scope('site-a', ORG), firestore: failing, count: 1 }),
    ).resolves.toBeUndefined()
  })
})
