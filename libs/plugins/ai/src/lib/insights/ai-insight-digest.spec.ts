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

type Data = Record<string, any>

const mockDocs = new Map<string, Data>()
const mockJobs = new Map<string, Data>()
const mockCreated: Data[] = []
const mockCanceled: string[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__id__' },
}))
jest.mock('../jobs/ai-jobs', () => ({
  __esModule: true,
  createAiJob: async (_firestore: unknown, input: Data) => {
    const $id = `job-${mockCreated.length + 1}`
    mockCreated.push({ ...input, $id })
    mockJobs.set($id, { ...input, $id, status: 'queued' })
    return { ...input, $id }
  },
  getAiJob: async (_firestore: unknown, _orgId: string, jobId: string) => mockJobs.get(jobId) ?? null,
  cancelAiJob: async (_firestore: unknown, _orgId: string, jobId: string) => {
    mockCanceled.push(jobId)
    mockJobs.set(jobId, { ...mockJobs.get(jobId), status: 'canceled' })
  },
}))

import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { INSIGHT_DIGESTS_FIELD } from '@aglyn/aglyn/app-utils/notifications'
import {
  AI_INSIGHT_DIGEST_MARKERS,
  AI_INSIGHT_DIGEST_QUEUE,
  aiInsightDigestEmailText,
  runAiInsightDigestSweep,
  type AiInsightDigestDeps,
} from './ai-insight-digest'

/**
 * The weekly insights (AGL-2915): made on Monday only for the people who
 * asked and may generate on the site, delivered once each when written, and a
 * digest parked for credits given up without a word.
 */

const MONDAY = new Date('2026-09-14T06:00:00.000Z')
const MONDAY_AFTERNOON = new Date('2026-09-14T14:00:00.000Z')
const TUESDAY = new Date('2026-09-15T06:00:00.000Z')

function merge(target: Data, patch: Data): Data {
  const out: Data = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
        ? merge(out[key] ?? {}, value)
        : value
  }
  return out
}

const firestore = (() => {
  const snapshot = (path: string) => {
    const data = mockDocs.get(path)
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field], ref: ref(path) }
  }
  function ref(path: string): any {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => snapshot(path),
      set: async (value: Data, options?: { merge?: boolean }) => {
        mockDocs.set(path, options?.merge ? merge(mockDocs.get(path) ?? {}, value) : value)
      },
      // A dotted key replaces the value at its path, as `update` does.
      update: async (fields: Data) => {
        const next: Data = JSON.parse(JSON.stringify(mockDocs.get(path) ?? {}))
        for (const [key, value] of Object.entries(fields)) {
          const parts = key.split('.')
          let target = next
          for (const part of parts.slice(0, -1)) target = target[part] ??= {}
          target[parts[parts.length - 1]] = value
        }
        mockDocs.set(path, next)
      },
      collection: (name: string) => collection(`${path}/${name}`),
    }
  }
  function collection(path: string, filters: Array<[string, unknown]> = [], cap = Infinity, after: string | null = null): any {
    const query = () =>
      [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .filter((key) => filters.every(([field, value]) => mockDocs.get(key)?.[field] === value))
        .filter((key) => after === null || key.split('/').pop()! > after)
    return {
      doc: (id: string) => ref(`${path}/${id}`),
      where: (field: string, _op: string, value: unknown) => collection(path, [...filters, [field, value]], cap, after),
      orderBy: () => collection(path, filters, cap, after),
      limit: (n: number) => collection(path, filters, n, after),
      startAfter: (target: { id: string }) => collection(path, filters, cap, target.id),
      get: async () => ({ docs: query().slice(0, cap).map(snapshot) }),
    }
  }
  return {
    collection: (name: string) => collection(name),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((entry) => snapshot(entry.path)),
  } as unknown as FirebaseFirestore.Firestore
})()

const members: AglynOrgMember[] = [
  { $id: 'asker', role: 'editor', allHosts: true, email: 'asker@example.com' } as unknown as AglynOrgMember,
  { $id: 'quiet', role: 'editor', allHosts: true, email: 'quiet@example.com' } as unknown as AglynOrgMember,
]

const sent: Data[] = []
const notified: Data[] = []

function deps(now: Date, patch: Partial<AiInsightDigestDeps> = {}): AiInsightDigestDeps {
  return {
    firestore,
    now,
    flagValue: { enabled: true } as never,
    listMembers: async () => members,
    mayGenerate: async () => true,
    paused: async () => false,
    notify: async (uid, payload) => {
      notified.push({ uid, ...payload })
    },
    send: async (email) => {
      sent.push(email)
      return { sent: true, rateLimited: false }
    },
    consoleOrigin: 'https://app.example.com',
    ...patch,
  }
}

beforeEach(() => {
  mockDocs.clear()
  mockJobs.clear()
  mockCreated.length = 0
  mockCanceled.length = 0
  sent.length = 0
  notified.length = 0
  // Free carries `aiGenerative` of its own; a paid plan carries it with the AI add-on.
  mockDocs.set('orgs/org-1', { plan: 'free', slug: 'acme', enabledPlugins: ['ai'] })
  mockDocs.set('hosts/host-1', { orgId: 'org-1', displayName: 'Acme Roofing', subdomain: 'acme' })
  mockDocs.set('users/asker', { [INSIGHT_DIGESTS_FIELD]: { 'org-1': true } })
  mockDocs.set('users/quiet', {})
})

describe('Monday', () => {
  it('makes one digest a site for the people who asked, once a week', async () => {
    const report = await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })
    expect(report).toMatchObject({ week: '2026-W38', swept: 1, created: 1, done: true })
    expect(mockCreated).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'insight',
        brief: 'Weekly insights for Acme Roofing',
        inputs: { surface: 'digest', week: '2026-W38' },
        createdBy: 'asker',
      }),
    ])
    expect(mockDocs.get(`${AI_INSIGHT_DIGEST_QUEUE}/2026-W38`)).toEqual({ week: '2026-W38', pending: { 'org-1': true } })
    // The afternoon run makes nothing twice.
    await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON), { cursor: null })
    expect(mockCreated).toHaveLength(1)
  })

  it('makes nothing for a workspace nobody asked for, or where the asker may not generate', async () => {
    mockDocs.set('users/asker', {})
    expect((await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })).created).toBe(0)
    mockDocs.set('users/asker', { [INSIGHT_DIGESTS_FIELD]: { 'org-1': true } })
    expect((await runAiInsightDigestSweep(deps(MONDAY, { mayGenerate: async () => false }), { cursor: null })).created).toBe(0)
    expect((await runAiInsightDigestSweep(deps(MONDAY, { paused: async () => true }), { cursor: null })).created).toBe(0)
    expect(mockCreated).toEqual([])
  })

  it('makes nothing on any other day', async () => {
    expect((await runAiInsightDigestSweep(deps(TUESDAY), { cursor: null })).created).toBe(0)
  })
})

describe('delivery', () => {
  beforeEach(async () => {
    await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })
  })

  it('sends a written digest to the people who asked, once each', async () => {
    mockJobs.set('job-1', { $id: 'job-1', status: 'done' })
    mockDocs.set('orgs/org-1/aiInsights/job-1', {
      insights: [{ text: 'Page views rose 14.7% to 1,204.', cites: [{ table: 't1', rows: [0] }] }],
    })
    const report = await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON), { cursor: null })
    expect(report.delivered).toBe(1)
    expect(sent).toEqual([
      expect.objectContaining({ to: 'asker@example.com', subject: 'Your weekly insights for Acme Roofing' }),
    ])
    expect(sent[0].text).toContain('1. Page views rose 14.7% to 1,204.')
    expect(sent[0].text).toContain('https://app.example.com/acme/hosts/acme/analytics')
    expect(notified).toEqual([expect.objectContaining({ uid: 'asker', link: '/host-1/analytics', title: 'Weekly insights · Acme Roofing' })])
    // Delivered, the marker names nobody, the week's workspace leaves the
    // queue, and nothing is sent twice.
    expect(mockDocs.get(`orgs/org-1/${AI_INSIGHT_DIGEST_MARKERS}/2026-W38`)?.sites['host-1']).toEqual({
      jobId: 'job-1',
      name: 'Acme Roofing',
      state: 'delivered',
    })
    expect(mockDocs.get(`${AI_INSIGHT_DIGEST_QUEUE}/2026-W38`)?.pending).toEqual({ 'org-1': false })
    await runAiInsightDigestSweep(deps(TUESDAY), { cursor: null })
    expect(sent).toHaveLength(1)
  })

  it('writes no link it cannot make absolute', () => {
    const text = aiInsightDigestEmailText({
      siteName: 'Acme Roofing',
      productName: 'Aglyn',
      insights: [{ text: 'Page views rose 14.7%.' }],
      analyticsUrl: null,
      settingsUrl: null,
    })
    expect(text).toContain('1. Page views rose 14.7%.')
    expect(text).not.toMatch(/https?:|\s\/[a-z]/)
  })

  it('gives up a digest parked for credits, silently', async () => {
    mockJobs.set('job-1', { $id: 'job-1', status: 'needs_input' })
    const report = await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON), { cursor: null })
    expect(report).toMatchObject({ delivered: 0, skipped: 1 })
    expect(mockCanceled).toEqual(['job-1'])
    expect(sent).toEqual([])
    expect(notified).toEqual([])
  })

  it('waits for a digest still being written, and stops without sending twice when the send rate refuses', async () => {
    expect((await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON), { cursor: null })).delivered).toBe(0)
    mockJobs.set('job-1', { $id: 'job-1', status: 'done' })
    mockDocs.set('orgs/org-1/aiInsights/job-1', { insights: [{ text: 'Page views rose 14.7%.', cites: [] }] })
    const refused = await runAiInsightDigestSweep(
      deps(MONDAY_AFTERNOON, { send: async () => ({ sent: false, rateLimited: true }) }),
      { cursor: null },
    )
    expect(refused.deferred).toBe(true)
    expect(notified).toEqual([])
    await runAiInsightDigestSweep(deps(TUESDAY), { cursor: null })
    expect(sent).toHaveLength(1)
  })
})
