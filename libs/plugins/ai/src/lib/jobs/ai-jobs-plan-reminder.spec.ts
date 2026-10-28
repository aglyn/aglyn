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
 * ONE MORE REMINDER, A DAY AFTER A PLAN IS READY, AND NEVER A SECOND (AGL-4076).
 *
 * In the 10/10 to 10/28 window 13 plans waited 4 to 428 hours for their
 * confirmation after the single notice they were sent the moment they were
 * ready, while the person was usually looking at the plan card. The AI jobs
 * beat now sends one more `content.aiJobNeedsYou` a day later, marks the job,
 * and never sends another, against a fake Firestore that answers the beat's
 * collection-group read and its transaction.
 */

jest.mock('@aglyn/tenant-data-admin/server/notifications', () => ({
  __esModule: true,
  notifyUsers: jest.fn(),
}))

jest.mock('@aglyn/tenant-data-admin/server/operator-alerts', () => ({
  __esModule: true,
  raiseOperatorAlert: jest.fn(),
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobTransitionListener: jest.fn(),
}))

import { aiJobPlanReminderNotice } from '../model/ai-job-notice'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_PLAN_REMINDER_AFTER_MS,
  AI_PLAN_REMINDER_MAX,
  AI_PLAN_REMINDER_WINDOW_MS,
  aiPlanReminderDue,
  sweepAiPlanReminders,
} from './ai-jobs-notify'

const HOUR = 60 * 60_000
const NOW = Date.UTC(2026, 9, 28, 18, 0, 0)

type Doc = Record<string, unknown>

/** The fake: `orgs/{org}/aiJobs/{job}` documents, the beat's one query shape, and a transaction. */
function fakeFirestore(docs: Map<string, Doc>) {
  const millis = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))
  // A snapshot is what the document held when it was read, as Firestore's are.
  const snapshotOf = (path: string) => {
    const held = docs.get(path)
    return { id: path.split('/').pop() as string, ref: { path }, exists: held !== undefined, data: () => held }
  }
  type Filter = { field: string; op: string; value: unknown }
  const query = (filters: Filter[] = [], order: string | null = null, limit = Infinity) => ({
    where: (field: string, op: string, value: unknown) => query([...filters, { field, op, value }], order, limit),
    orderBy: (field: string) => query(filters, field, limit),
    limit: (count: number) => query(filters, order, count),
    get: async () => {
      let paths = [...docs.keys()].filter((path) => path.split('/').slice(-2, -1)[0] === 'aiJobs')
      paths = paths.filter((path) =>
        filters.every(({ field, op, value }) => {
          const stored = (docs.get(path) ?? {})[field]
          if (op === '==') return stored === value
          if (op === '<=') return millis(stored) <= millis(value)
          if (op === '>') return millis(stored) > millis(value)
          throw new Error(`unsupported operator ${op}`)
        }),
      )
      if (order) paths.sort((a, b) => millis(docs.get(a)?.[order]) - millis(docs.get(b)?.[order]))
      const listed = paths.slice(0, limit).map(snapshotOf)
      return { size: listed.length, docs: listed }
    },
  })
  const writes: string[] = []
  return {
    writes,
    db: {
      collectionGroup: (name: string) => {
        expect(name).toBe('aiJobs')
        return query()
      },
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const queued: Array<() => void> = []
        const tx = {
          get: async (ref: { path: string }) => snapshotOf(ref.path),
          update: (ref: { path: string }, data: Doc) => {
            queued.push(() => {
              writes.push(ref.path)
              docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
            })
          },
        }
        const out = await fn(tx)
        for (const write of queued) write()
        return out
      },
    } as unknown as FirebaseFirestore.Firestore,
  }
}

/** A job's stored fields; a patch may set any, as a stored document may hold them. */
const job = (patch: Doc = {}): Doc => ({
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'page',
  status: 'needs_review',
  brief: 'An about page',
  inputs: {},
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'uid-creator',
  review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
  updatedAt: new Date(NOW - 25 * HOUR),
  ...patch,
})

const SITE = { name: 'Acme Roofing', url: 'https://acme.example.test' }

function setup(entries: Record<string, Doc>) {
  const docs = new Map(Object.entries(entries))
  const fake = fakeFirestore(docs)
  const notify = jest.fn().mockResolvedValue(undefined)
  const readSite = jest.fn().mockResolvedValue(SITE)
  const sweep = (at = NOW) => sweepAiPlanReminders({ firestore: fake.db, now: () => at, notify, readSite })
  return { docs, fake, notify, readSite, sweep }
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the plan reminder (AGL-4076)', () => {
  it('sends one more needs-you notice a day after a plan is ready, and marks the job', async () => {
    const { docs, notify, readSite, sweep } = setup({ 'orgs/org-1/aiJobs/job-1': job() })
    expect(await sweep()).toEqual({ scanned: 1, reminded: 1 })
    expect(readSite).toHaveBeenCalledWith('host-1')
    expect(notify).toHaveBeenCalledTimes(1)
    const [uids, notice, options] = notify.mock.calls[0]
    expect(uids).toEqual(['uid-creator'])
    expect(notice).toMatchObject({
      type: 'content.aiJobNeedsYou',
      title: 'Your page plan for Acme Roofing is still waiting for you',
      link: '/host-1?aiJob=job-1',
      orgId: 'org-1',
      hostId: 'host-1',
    })
    expect(notice.body).toContain('Nothing is built until you confirm the plan.')
    expect(notice.body).toContain('This is the only reminder.')
    expect(options).toEqual({
      emailDetails: [
        { label: 'Site', value: 'Acme Roofing' },
        { label: 'Address', value: 'https://acme.example.test' },
      ],
    })
    // The mark, at the beat's clock; the job's age is left as its plan's.
    expect(docs.get('orgs/org-1/aiJobs/job-1')?.['remindedAt']).toEqual(new Date(NOW))
    expect(docs.get('orgs/org-1/aiJobs/job-1')?.['updatedAt']).toEqual(new Date(NOW - 25 * HOUR))
  })

  it('never sends a second one, on the next beat or a day later', async () => {
    const { notify, sweep } = setup({ 'orgs/org-1/aiJobs/job-1': job() })
    await sweep()
    await sweep(NOW + 60_000)
    await sweep(NOW + 2 * HOUR)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('waits a full day, and leaves a plan waiting longer than the window alone', async () => {
    const { notify, sweep } = setup({
      'orgs/org-1/aiJobs/fresh': job({ updatedAt: new Date(NOW - 23 * HOUR) }),
      // A plan already a week old when this shipped is not mailed now.
      'orgs/org-1/aiJobs/stale': job({ updatedAt: new Date(NOW - 7 * 24 * HOUR) }),
    })
    expect(await sweep()).toEqual({ scanned: 0, reminded: 0 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('never reminds a job that moved on, was cancelled, was deleted or is not a plan', async () => {
    const { notify, sweep } = setup({
      'orgs/org-1/aiJobs/confirmed': job({ status: 'queued' }),
      'orgs/org-1/aiJobs/canceled': job({ status: 'canceled' }),
      'orgs/org-1/aiJobs/doctrine': job({ review: { reason: 'doctrine', message: 'x', findings: [] } }),
      'orgs/org-1/aiJobs/asked': job({ cancelRequested: { by: 'uid-creator', at: new Date(NOW) } }),
      'orgs/org-1/aiJobs/guided': job({ kind: 'site', inputs: { autoConfirm: true } }),
      'orgs/org-1/aiJobs/nobody': job({ createdBy: '' }),
    })
    expect(await sweep()).toEqual({ scanned: 4, reminded: 0 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('reads the job again in the transaction: one confirmed or deleted since the read is not told', async () => {
    const { docs, fake, notify, readSite } = setup({
      'orgs/org-1/aiJobs/confirmed': job(),
      'orgs/org-1/aiJobs/deleted': job({ updatedAt: new Date(NOW - 25 * HOUR + 1) }),
    })
    // Between the beat's read and its transaction, a person confirms one plan and deletes the other job.
    readSite.mockImplementation(async () => {
      docs.set('orgs/org-1/aiJobs/confirmed', { ...docs.get('orgs/org-1/aiJobs/confirmed'), status: 'queued' })
      docs.delete('orgs/org-1/aiJobs/deleted')
      return SITE
    })
    expect(await sweepAiPlanReminders({ firestore: fake.db, now: () => NOW, notify, readSite })).toEqual({
      scanned: 2,
      reminded: 0,
    })
    expect(notify).not.toHaveBeenCalled()
    expect(fake.writes).toEqual([])
  })

  it('does not remind about a plan for a site that is gone', async () => {
    const { notify, readSite, sweep, fake } = setup({ 'orgs/org-1/aiJobs/job-1': job() })
    readSite.mockResolvedValue(null)
    expect(await sweep()).toEqual({ scanned: 1, reminded: 0 })
    expect(notify).not.toHaveBeenCalled()
    expect(fake.writes).toEqual([])
  })

  it('reminds about a workspace job with no site, with no site details', async () => {
    const { notify, readSite, sweep } = setup({ 'orgs/org-1/aiJobs/job-1': job({ hostId: null, kind: 'build' }) })
    expect(await sweep()).toEqual({ scanned: 1, reminded: 1 })
    expect(readSite).not.toHaveBeenCalled()
    expect(notify.mock.calls[0]).toHaveLength(2)
    expect(notify.mock.calls[0][1]).toMatchObject({
      title: 'Your build plan is still waiting for you',
      link: '/org?aiJob=job-1',
    })
  })

  it('sends a few a beat, oldest first, and the rest on the next', async () => {
    const entries: Record<string, Doc> = {}
    for (let index = 0; index < AI_PLAN_REMINDER_MAX + 2; index += 1) {
      entries[`orgs/org-1/aiJobs/job-${index}`] = job({ updatedAt: new Date(NOW - 25 * HOUR - index * 60_000) })
    }
    const { notify, sweep } = setup(entries)
    expect((await sweep()).reminded).toBe(AI_PLAN_REMINDER_MAX)
    const first = notify.mock.calls.map((call) => String(call[1].link))
    expect(first[0]).toContain(`job-${AI_PLAN_REMINDER_MAX + 1}`)
    expect((await sweep(NOW + 60_000)).reminded).toBe(2)
    expect(notify).toHaveBeenCalledTimes(AI_PLAN_REMINDER_MAX + 2)
  })

  it('keeps one job’s fault to that job, and tries it again on the next beat', async () => {
    const { notify, readSite, sweep } = setup({
      'orgs/org-1/aiJobs/a': job(),
      'orgs/org-1/aiJobs/b': job({ updatedAt: new Date(NOW - 25 * HOUR + 1) }),
    })
    readSite.mockRejectedValueOnce(new Error('unavailable'))
    expect((await sweep()).reminded).toBe(1)
    expect((await sweep(NOW + 60_000)).reminded).toBe(1)
    expect(notify).toHaveBeenCalledTimes(2)
  })
})

describe('when a plan is owed its reminder', () => {
  const at = (hours: number) => job({ updatedAt: new Date(NOW - hours * HOUR) }) as unknown as AiJob

  it('is from a day after it was ready until the window closes', () => {
    expect(AI_PLAN_REMINDER_AFTER_MS).toBe(24 * HOUR)
    expect(aiPlanReminderDue(at(23.9), NOW)).toBe(false)
    expect(aiPlanReminderDue(at(24), NOW)).toBe(true)
    expect(aiPlanReminderDue(at(24 + AI_PLAN_REMINDER_WINDOW_MS / HOUR - 0.1), NOW)).toBe(true)
    expect(aiPlanReminderDue(at(24 + AI_PLAN_REMINDER_WINDOW_MS / HOUR), NOW)).toBe(false)
  })

  it('is never once the job was reminded', () => {
    expect(aiPlanReminderDue({ ...at(25), remindedAt: new Date(NOW - HOUR) } as unknown as AiJob, NOW)).toBe(false)
  })
})

describe('the reminder’s words', () => {
  it('asks again for the one detail a plan waits on', () => {
    const notice = aiJobPlanReminderNotice({
      $id: 'job-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'page',
      review: { reason: 'plan' },
      input: { message: 'Which booking page should the button open?' },
    })
    expect(notice).toMatchObject({
      type: 'content.aiJobNeedsYou',
      title: 'Your page still needs one detail from you',
    })
    expect(notice.body.startsWith('Which booking page should the button open?')).toBe(true)
  })
})
