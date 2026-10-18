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
 * The empty site a cancelled or failed guided start left is removed after
 * the grace period, and only then, and only while it is truly empty
 * (AGL-3936).
 *
 * The fixtures are the production shapes, read 2026-10-18 with a read-only
 * probe: kc-x-carder (host NPmSAP03oQ, job oOUgupM28I) cancelled 13 s after
 * it was created with both steps pending and nothing spent, its site holding
 * one "Created the site" entry and two visitors' beacon rows; pflomo (host
 * G1KmXMdCU0, job VUQuL_gDlq) the same 35 s in. Ids here are made up. The
 * erase itself is the console's (`core.site-erase`), replaced here by a spy;
 * `ai-empty-site-sweep.emulator.spec.ts` runs the real one.
 */

import {
  AI_EMPTY_SITE_ACTIVITY,
  AI_EMPTY_SITE_GRACE_MS,
  AI_EMPTY_SITE_MAX_ATTEMPTS,
  AI_EMPTY_SITE_REASON,
  AI_EMPTY_SITE_RETRY_MS,
  aiJobLeavesEmptySite,
  sweepAiEmptySites,
} from './ai-empty-site-sweep'

type Data = Record<string, unknown>
let docs = new Map<string, Data>()

function millis(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value)
}

function makeFirestore() {
  const snapshotOf = (path: string) => ({
    id: path.split('/').pop() as string,
    exists: docs.has(path),
    ref: makeDoc(path),
    data: () => docs.get(path),
    get: (field: string) => (docs.get(path) ?? {})[field],
  })
  const childrenOf = (prefix: string) =>
    [...docs.keys()].filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
  type Filter = { field: string; op: string; value: unknown }
  const makeQuery = (prefix: string, filters: Filter[] = [], order: string | null = null, limit = Infinity): any => ({
    where: (field: string, op: string, value: unknown) => makeQuery(prefix, [...filters, { field, op, value }], order, limit),
    orderBy: (field: string) => makeQuery(prefix, filters, field, limit),
    limit: (count: number) => makeQuery(prefix, filters, order, count),
    get: async () => {
      let paths = childrenOf(prefix).filter((path) =>
        filters.every(({ field, op, value }) => {
          const stored = (docs.get(path) ?? {})[field]
          if (op === '==') return stored === value
          if (op === '<=') return millis(stored) <= millis(value)
          throw new Error(`unsupported ${op}`)
        }),
      )
      if (order) paths = paths.sort((a, b) => millis(docs.get(a)?.[order]) - millis(docs.get(b)?.[order]))
      const found = paths.slice(0, limit).map(snapshotOf)
      return { docs: found, size: found.length, empty: found.length === 0 }
    },
  })
  const makeDoc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Data, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data })
    },
    delete: async () => {
      docs.delete(path)
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
    ...makeQuery(prefix),
  })
  return { collection: (name: string) => makeCollection(name) } as unknown as FirebaseFirestore.Firestore
}

const firestore = makeFirestore()
const ORG = 'org-kc'
const HOST = 'host-kc'
const JOB = 'job-kc'
/** When the job was cancelled: 13 s after it was created. */
const SETTLED = new Date('2026-10-15T13:12:34.202Z')
const DUE = new Date(SETTLED.getTime() + AI_EMPTY_SITE_GRACE_MS)
const AFTER_DUE = DUE.getTime() + 30_000

/** kc-x-carder's site as production holds it, with no page and two visitors. */
function seedEmptySite() {
  docs.set(`hosts/${HOST}`, {
    displayName: 'Kc x carder',
    subdomain: 'kc-x-carder',
    orgId: ORG,
    screens: {},
    theme: { mode: 'light' },
    seo: {},
    enabledPlugins: ['ai'],
    suspended: false,
    hasCustomDomain: false,
    memberRoles: { 'uid-kc': 'admin' },
  })
  docs.set(`hosts/${HOST}/activity/a1`, { action: 'Created the site', target: { type: 'host', id: HOST } })
  docs.set(`hosts/${HOST}/analytics/2026-10-15`, { visitors: 2, total: 2 })
  docs.set(`orgs/${ORG}/aiJobs/${JOB}`, {
    orgId: ORG,
    hostId: HOST,
    kind: 'site',
    status: 'canceled',
    steps: [
      { name: 'plan', status: 'pending', creditsSpent: 0, attempts: 0 },
      { name: 'generate', status: 'pending', creditsSpent: 0, attempts: 0 },
    ],
    outputs: [],
    creditsSpent: 0,
    creditsReserved: 0,
    lease: null,
    cancelRequested: { at: SETTLED, by: 'uid-kc' },
    updatedAt: SETTLED,
  })
  docs.set(`aiEmptySiteSweeps/${HOST}`, {
    hostId: HOST,
    orgId: ORG,
    jobId: JOB,
    status: 'canceled',
    settledAt: SETTLED,
    dueAt: DUE,
    attempts: 0,
  })
}

const erase = jest.fn(async (..._args: unknown[]) => ({ erased: true as const }))
const sweep = (at = AFTER_DUE, extra: Partial<Parameters<typeof sweepAiEmptySites>[0]> = {}) =>
  sweepAiEmptySites({ firestore, now: () => at, erase: erase as never, ...extra })

beforeEach(() => {
  docs = new Map()
  erase.mockReset()
  erase.mockResolvedValue({ erased: true })
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a cancelled start with its plan pending and nothing spent (kc-x-carder, 2026-10-15)', () => {
  it('is left alone until the grace period is over', async () => {
    seedEmptySite()
    expect(await sweep(DUE.getTime() - 1)).toEqual({ due: 0, removed: 0, kept: 0, later: 0 })
    expect(erase).not.toHaveBeenCalled()
    expect(docs.has(`aiEmptySiteSweeps/${HOST}`)).toBe(true)
  })

  it('then its site is removed through the console’s delete path, and the job says so', async () => {
    seedEmptySite()
    expect(await sweep()).toEqual({ due: 1, removed: 1, kept: 0, later: 0 })
    expect(erase).toHaveBeenCalledWith({
      hostId: HOST,
      orgId: ORG,
      activity: AI_EMPTY_SITE_ACTIVITY,
      reason: AI_EMPTY_SITE_REASON,
    })
    expect(docs.has(`aiEmptySiteSweeps/${HOST}`)).toBe(false)
    expect(docs.get(`orgs/${ORG}/aiJobs/${JOB}`)?.['siteRemoved']).toEqual({
      at: new Date(AFTER_DUE),
      name: 'Kc x carder',
    })
  })
})

describe('a failed start that built nothing', () => {
  it('is removed the same way, its listing proposal no reason to keep it', async () => {
    seedEmptySite()
    docs.set(`orgs/${ORG}/aiJobs/${JOB}`, {
      ...docs.get(`orgs/${ORG}/aiJobs/${JOB}`),
      status: 'failed',
      error: 'We could not build this site.',
      cancelRequested: null,
      outputs: [{ resource: 'seo', id: 'listing', hostId: HOST, label: 'Search listing' }],
    })
    expect((await sweep()).removed).toBe(1)
  })
})

describe('a person who came back keeps the site', () => {
  const keptWith = async (change: () => void, reason: string) => {
    seedEmptySite()
    change()
    expect(await sweep()).toEqual({ due: 1, removed: 0, kept: 1, later: 0 })
    expect(erase).not.toHaveBeenCalled()
    expect(docs.has(`aiEmptySiteSweeps/${HOST}`)).toBe(false)
    expect(docs.get(`orgs/${ORG}/aiJobs/${JOB}`)?.['siteRemoved']).toBeUndefined()
    expect(console.info).toHaveBeenCalledWith('ai empty site kept', expect.objectContaining({ reason }))
  }

  it('by starting again: a second job on the site', () =>
    keptWith(() => {
      docs.set(`orgs/${ORG}/aiJobs/job-again`, { orgId: ORG, hostId: HOST, kind: 'site', status: 'running' })
    }, 'another-job'))

  it('by trying the same job again: it is no longer ended', () =>
    keptWith(() => {
      docs.set(`orgs/${ORG}/aiJobs/${JOB}`, { ...docs.get(`orgs/${ORG}/aiJobs/${JOB}`), status: 'queued' })
    }, 'job-moved-on'))

  it('by a layout written on the site', () =>
    keptWith(() => {
      docs.set(`hosts/${HOST}/layouts/l1`, { displayName: 'Header' })
    }, 'has-layouts'))

  it('by using the starter: a published Home page', () =>
    keptWith(() => {
      docs.set(`hosts/${HOST}`, { ...docs.get(`hosts/${HOST}`), screens: { home: '/' } })
      docs.set(`hosts/${HOST}/screens/home`, { displayName: 'Home' })
    }, 'routed-pages'))

  it('by an email, a form or a media file', async () => {
    for (const [collection, reason] of [
      ['screens', 'has-screens'],
      ['forms', 'has-forms'],
      ['media', 'has-media'],
    ] as const) {
      docs = new Map()
      erase.mockClear()
      await keptWith(() => {
        docs.set(`hosts/${HOST}/${collection}/x`, { displayName: 'Something' })
      }, reason)
    }
  })

  it('by editing it: an entry in its feed other than its creation and the AI job’s', () =>
    keptWith(() => {
      docs.set(`hosts/${HOST}/activity/a2`, { action: 'Updated the theme', target: { type: 'theme' } })
    }, 'edited'))

  it('by connecting a custom domain', () =>
    keptWith(() => {
      docs.set(`hosts/${HOST}`, { ...docs.get(`hosts/${HOST}`), cname: 'kccards.example', hasCustomDomain: true })
    }, 'custom-domain'))

  it('and a site already deleted by its admin only drops the marker', () =>
    keptWith(() => {
      docs.delete(`hosts/${HOST}`)
    }, 'site-gone'))
})

it('an AI job’s own feed entries are not a person editing the site', async () => {
  seedEmptySite()
  docs.set(`hosts/${HOST}/activity/a2`, { action: 'ai.job.created', target: { type: 'aiJob' } })
  expect((await sweep()).removed).toBe(1)
})

it('a job that ended again after the marker waits a full grace period from then', async () => {
  seedEmptySite()
  const again = new Date(SETTLED.getTime() + 20 * 60_000)
  docs.set(`orgs/${ORG}/aiJobs/${JOB}`, { ...docs.get(`orgs/${ORG}/aiJobs/${JOB}`), updatedAt: again })
  expect(await sweep()).toEqual({ due: 1, removed: 0, kept: 0, later: 1 })
  expect(docs.get(`aiEmptySiteSweeps/${HOST}`)?.['dueAt']).toEqual(new Date(again.getTime() + AI_EMPTY_SITE_GRACE_MS))
  expect(erase).not.toHaveBeenCalled()
})

it('an eraser that cannot answer is tried again later, then given up', async () => {
  seedEmptySite()
  erase.mockResolvedValue({ erased: false, reason: 'unavailable' } as never)
  expect((await sweep()).later).toBe(1)
  expect(docs.get(`aiEmptySiteSweeps/${HOST}`)).toMatchObject({
    attempts: 1,
    dueAt: new Date(AFTER_DUE + AI_EMPTY_SITE_RETRY_MS),
  })
  docs.set(`aiEmptySiteSweeps/${HOST}`, {
    ...docs.get(`aiEmptySiteSweeps/${HOST}`),
    attempts: AI_EMPTY_SITE_MAX_ATTEMPTS - 1,
    dueAt: DUE,
  })
  await sweep()
  expect(docs.has(`aiEmptySiteSweeps/${HOST}`)).toBe(false)
  expect(docs.get(`orgs/${ORG}/aiJobs/${JOB}`)?.['siteRemoved']).toBeUndefined()
})

it('a site its consent group needs is kept, as the delete route keeps it', async () => {
  seedEmptySite()
  erase.mockResolvedValue({ erased: false, reason: 'consent-group' } as never)
  expect(await sweep()).toEqual({ due: 1, removed: 0, kept: 1, later: 0 })
  expect(docs.has(`aiEmptySiteSweeps/${HOST}`)).toBe(false)
})

it('a beat decides a few at a time, oldest first', async () => {
  for (let index = 0; index < 5; index += 1) {
    docs.set(`aiEmptySiteSweeps/h${index}`, {
      hostId: `h${index}`,
      orgId: ORG,
      jobId: `j${index}`,
      dueAt: new Date(DUE.getTime() - index * 1_000),
    })
  }
  const result = await sweep(AFTER_DUE, { max: 3 })
  expect(result).toEqual({ due: 3, removed: 0, kept: 3, later: 0 })
  expect([...docs.keys()].sort()).toEqual(['aiEmptySiteSweeps/h0', 'aiEmptySiteSweeps/h1'])
})

describe('which jobs leave an empty site', () => {
  const base = { kind: 'site' as const, hostId: HOST, outputs: [], siteRemoved: null }
  it('a site start that ended cancelled or failed with nothing but its listing', () => {
    expect(aiJobLeavesEmptySite({ ...base, status: 'canceled' })).toBe(true)
    expect(aiJobLeavesEmptySite({ ...base, status: 'failed', outputs: [{ resource: 'seo', id: 's', hostId: HOST, label: 'L' }] })).toBe(true)
  })
  it('not one that built something, is still going, is another kind, or was already removed', () => {
    expect(
      aiJobLeavesEmptySite({ ...base, status: 'failed', outputs: [{ resource: 'layout', id: 'l', hostId: HOST, label: 'Header' }] }),
    ).toBe(false)
    expect(aiJobLeavesEmptySite({ ...base, status: 'needs_review' })).toBe(false)
    expect(aiJobLeavesEmptySite({ ...base, status: 'done' })).toBe(false)
    expect(aiJobLeavesEmptySite({ ...base, kind: 'page', status: 'canceled' })).toBe(false)
    expect(aiJobLeavesEmptySite({ ...base, hostId: null, status: 'canceled' })).toBe(false)
    expect(aiJobLeavesEmptySite({ ...base, status: 'canceled', siteRemoved: { at: new Date() as never, name: null } })).toBe(false)
  })
})
