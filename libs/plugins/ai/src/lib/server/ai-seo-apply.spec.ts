/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, which has no TextEncoder
 * for the node map codec.
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
 * "Apply all" on a site SEO audit (AGL-2910), and the proof that it is DRAFTS
 * ONLY: content fixes land in a NEW version of each page and the published
 * version is byte-for-byte what it was; the screen's `seo` — which the live
 * page's head is served from — and its `versionId` are untouched, the
 * listing values are staged on the job for the page's SEO card instead; and
 * the host document, which the served `/llms.txt` and structured data are
 * built from, is never written.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
let mockNextId = 0
const mockWrites: string[] = []

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    ref: mockRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ?? {})[field],
  }
}

function mockRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => mockCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    create: async (data: Doc) => {
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockWrites.push(path)
      mockDocs.set(path, data)
    },
    set: async (data: Doc, options?: { merge?: boolean }) => {
      mockWrites.push(path)
      mockDocs.set(path, options?.merge ? { ...(mockDocs.get(path) ?? {}), ...data } : data)
    },
  }
}

function mockCollection(prefix: string): any {
  return {
    doc: (id: string) => mockRef(`${prefix}/${id}`),
    add: async (data: Doc) => {
      const path = `${prefix}/auto-${++mockNextId}`
      mockWrites.push(path)
      mockDocs.set(path, data)
      return mockRef(path)
    },
  }
}

const mockFirestore = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const queued: Array<() => void> = []
    const result = await fn({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Doc, options?: { merge?: boolean }) => {
        queued.push(() => {
          mockWrites.push(ref.path)
          mockDocs.set(ref.path, options?.merge ? { ...(mockDocs.get(ref.path) ?? {}), ...data } : data)
        })
      },
    })
    for (const write of queued) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const mockGate = jest.fn()
const mockLogAiSeoApplied = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements').checkEntitlement,
  createResourceUid: () => `version-${++mockNextId}`,
  encodeStoredNodes: jest.requireActual('@aglyn/aglyn/app-utils/stored-nodes').encodeStoredNodes,
  hostRoleCanWrite: jest.requireActual('@aglyn/aglyn/app-utils/organizations').hostRoleCanWrite,
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  lockdownRefusal: async () => null,
}))
jest.mock('./ai-jobs-gate', () => ({
  __esModule: true,
  aiJobsGate: (...args: unknown[]) => mockGate(...args),
}))
jest.mock('../activity/ai-activity', () => ({
  __esModule: true,
  logAiJobCreated: async () => undefined,
  logAiJobOutput: async () => undefined,
  logAiJobCanceled: async () => undefined,
  logAiJobNeedsInput: async () => undefined,
  logAiSeoApplied: (...args: unknown[]) => mockLogAiSeoApplied(...args),
}))

import { buildLlmsTxt } from '@aglyn/aglyn/app-utils/llms-txt'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { getAiJob } from '../jobs/ai-jobs'
import type { AiSeoAuditReport, AiSeoFixesBatch } from '../model/ai-seo'
import { aiSeoAuditView } from '../model/ai-seo'
import { AI_SEO_APPLY_VERSIONING_COPY, POST, applyAiSeoAudit } from './ai-seo-apply'

const ORG = 'org-1'
const HOST = 'host-1'
const NOW = new Date('2026-09-15T12:00:00.000Z')

const LAMPS_NODES = {
  root: { $id: 'root', componentId: 'div', parentId: null, props: {}, nodes: ['main'] },
  main: { $id: 'main', componentId: 'section', parentId: 'root', props: { component: 'main' }, nodes: ['lh', 'limg'] },
  lh: { $id: 'lh', componentId: 'muiTypography', parentId: 'main', props: { variant: 'h2', children: 'Our lamps' }, nodes: [] },
  limg: { $id: 'limg', componentId: 'image', parentId: 'main', props: { src: 'media:host-1/lamp' }, nodes: [] },
}

const report: AiSeoAuditReport = {
  kind: 'audit',
  pages: [
    { screenId: 'lamps', path: '/lamps', name: 'Lamps', versionId: 'lv', score: 45, findings: [], keywords: [] },
    { screenId: 'about', path: '/about', name: 'About', versionId: 'av', score: 80, findings: [], keywords: [] },
  ],
  skipped: 0,
  site: [],
  siteProposal: false,
  queue: ['lamps', 'about'],
  batchSize: 8,
  score: 63,
  notes: [],
}

const fixes: AiSeoFixesBatch = {
  kind: 'fixes',
  batch: 1,
  fixes: [
    {
      screenId: 'lamps',
      values: { title: 'Brass desk lamps', description: 'Hand-finished brass desk lamps.' },
      content: [
        { kind: 'image-alt', nodeId: 'limg', alt: 'A brass desk lamp' },
        { kind: 'h1-set', nodeId: 'lh', text: 'Brass desk lamps' },
      ],
      guidance: [],
    },
    { screenId: 'about', values: { description: 'Who makes Acme lamps.' }, content: [], guidance: [] },
  ],
  notes: [],
}

function seed() {
  mockDocs = new Map<string, Doc>([
    [
      `hosts/${HOST}`,
      {
        orgId: ORG,
        displayName: 'Acme Lamps',
        subdomain: 'acme',
        memberRoles: { 'uid-editor': 'editor', 'uid-viewer': 'viewer' },
        screens: { lamps: 'lamps', about: 'about' },
        seo: { title: 'Acme Lamps', entity: { name: 'Acme' }, agent: {} },
      },
    ],
    [`hosts/${HOST}/screens/lamps`, { displayName: 'Lamps', versionId: 'lv', seo: { title: 'Lamps' } }],
    [`hosts/${HOST}/screens/lamps/versions/lv`, { screenId: 'lamps', hostId: HOST, displayName: 'v1', rootId: 'root', nodes: LAMPS_NODES }],
    [`hosts/${HOST}/screens/about`, { displayName: 'About', versionId: 'av', seo: {} }],
    [`orgs/${ORG}`, { plan: 'pro', billingStatus: 'active' }],
    [
      `orgs/${ORG}/aiJobs/job-1`,
      {
        orgId: ORG,
        hostId: HOST,
        kind: 'seo',
        status: 'done',
        brief: 'Audit this site',
        inputs: { target: 'site' },
        steps: [{ name: 'generate', status: 'done', creditsSpent: 9 }],
        outputs: [
          { resource: 'seo', id: 'audit:report', hostId: HOST, label: 'SEO audit', proposal: report },
          { resource: 'seo', id: 'audit:fixes:1', hostId: HOST, label: 'SEO fixes', proposal: fixes },
        ],
        creditsSpent: 9,
        createdBy: 'uid-editor',
      },
    ],
  ])
  mockWrites.length = 0
  mockNextId = 0
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

beforeEach(() => {
  seed()
  mockGate.mockReset()
  mockLogAiSeoApplied.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

async function apply(versioning = true) {
  const job = await getAiJob(mockFirestore, ORG, 'job-1')
  return applyAiSeoAudit(mockFirestore, {
    orgId: ORG,
    hostId: HOST,
    job: job!,
    view: aiSeoAuditView(job!.outputs)!,
    uid: 'uid-editor',
    versioning,
    now: NOW,
  })
}

describe('applyAiSeoAudit — drafts only', () => {
  it('opens a NEW version with the content fixes, and leaves the published version as it was', async () => {
    const published = clone(mockDocs.get(`hosts/${HOST}/screens/lamps/versions/lv`))
    const result = await apply()
    expect(result.versions).toEqual([{ screenId: 'lamps', versionId: 'version-1', name: 'Lamps', fixes: 2 }])

    const draft = mockDocs.get(`hosts/${HOST}/screens/lamps/versions/version-1`) as Doc
    expect(draft).toMatchObject({ displayName: 'SEO fixes', createdBy: 'uid-editor', rootId: 'root', screenId: 'lamps' })
    const nodes = decodeStoredNodes<Record<string, { props: Doc }>>(draft['nodes'])
    expect(nodes?.['limg'].props).toEqual({ src: 'media:host-1/lamp', alt: 'A brass desk lamp' })
    expect(nodes?.['lh'].props).toMatchObject({ component: 'h1', children: 'Brass desk lamps' })

    expect(clone(mockDocs.get(`hosts/${HOST}/screens/lamps/versions/lv`))).toEqual(published)
  })

  it('never writes a screen — not its listing, which the live head serves, nor the version it points at', async () => {
    const lamps = clone(mockDocs.get(`hosts/${HOST}/screens/lamps`))
    const about = clone(mockDocs.get(`hosts/${HOST}/screens/about`))
    await apply()
    expect(mockDocs.get(`hosts/${HOST}/screens/lamps`)).toEqual(lamps)
    expect(mockDocs.get(`hosts/${HOST}/screens/about`)).toEqual(about)
    // The only writes: the new version, and the job's own record of the apply.
    expect(mockWrites.sort()).toEqual([`hosts/${HOST}/screens/lamps/versions/version-1`, `orgs/${ORG}/aiJobs/job-1`].sort())
  })

  it('stages the listing values on the job, for each page’s SEO card to offer', async () => {
    const result = await apply()
    expect(result.staged).toEqual(['lamps', 'about'])
    expect(mockDocs.get(`orgs/${ORG}/aiJobs/job-1`)).toMatchObject({
      status: 'done',
      applied: { by: 'uid-editor', versions: { lamps: 'version-1' }, staged: ['lamps', 'about'] },
    })
  })

  it('never writes the host, so the served /llms.txt reads exactly as it did', async () => {
    const host = mockDocs.get(`hosts/${HOST}`) as Doc & { seo: { title: string; agent: Doc } }
    const served = () =>
      buildLlmsTxt({ siteName: host.seo.title, origin: 'https://acme.test', agent: host.seo.agent })
    const before = served()
    await apply()
    expect(mockDocs.get(`hosts/${HOST}`)).toBe(host)
    expect(served()).toBe(before)
    expect(mockWrites).not.toContain(`hosts/${HOST}`)
  })

  it('opens nothing new when applied twice', async () => {
    await apply()
    mockWrites.length = 0
    const second = await apply()
    expect(second.versions).toEqual([{ screenId: 'lamps', versionId: 'version-1', name: 'Lamps', fixes: 0 }])
    expect(mockWrites).toEqual([`orgs/${ORG}/aiJobs/job-1`])
  })

  it('opens no version on a plan without version history, and still stages the listings', async () => {
    const result = await apply(false)
    expect(result.versions).toEqual([])
    expect(result.skipped).toEqual([{ screenId: 'lamps', reason: AI_SEO_APPLY_VERSIONING_COPY }])
    expect(result.staged).toEqual(['lamps', 'about'])
    expect([...mockDocs.keys()].some((path) => path.endsWith('/versions/version-1'))).toBe(false)
  })

  it('skips a page deleted since the audit', async () => {
    mockDocs.set(`hosts/${HOST}/screens/lamps`, { versionId: 'lv', deletedAt: NOW })
    const result = await apply()
    expect(result.skipped).toEqual([{ screenId: 'lamps', reason: 'The page no longer exists.' }])
  })
})

describe('POST /api/ai/seo/apply', () => {
  const request = (body: Doc) =>
    new Request('https://console.example.test/api/ai/seo/apply', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const admit = (uid: string, staff = false) =>
    mockGate.mockResolvedValue({
      uid,
      staff,
      orgId: ORG,
      org: { plan: 'pro', billingStatus: 'active' },
      decoded: { uid, email: `${uid}@example.test` },
      firestore: mockFirestore,
    })

  it('answers the gate’s refusal as it is', async () => {
    mockGate.mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }))
    expect((await POST(request({ orgId: ORG, hostId: HOST, jobId: 'job-1' }))).status).toBe(404)
    expect(mockWrites).toEqual([])
  })

  it('refuses a member whose role on the site does not write its content, writing nothing', async () => {
    admit('uid-viewer')
    const response = await POST(request({ orgId: ORG, hostId: HOST, jobId: 'job-1' }))
    expect(response.status).toBe(403)
    expect(mockWrites).toEqual([])
  })

  it('refuses an audit that is still running, and a job that is not this site’s audit', async () => {
    admit('uid-editor')
    mockDocs.set(`orgs/${ORG}/aiJobs/job-1`, { ...mockDocs.get(`orgs/${ORG}/aiJobs/job-1`), status: 'running' })
    expect((await POST(request({ orgId: ORG, hostId: HOST, jobId: 'job-1' }))).status).toBe(409)
    mockDocs.set(`orgs/${ORG}/aiJobs/job-1`, { ...mockDocs.get(`orgs/${ORG}/aiJobs/job-1`), status: 'done', inputs: { target: 'screen' } })
    expect((await POST(request({ orgId: ORG, hostId: HOST, jobId: 'job-1' }))).status).toBe(404)
    expect(mockWrites).toEqual([])
  })

  it('applies for an editor: the drafts, the audit row, the activity row, and the summary', async () => {
    admit('uid-editor')
    const response = await POST(request({ orgId: ORG, hostId: HOST, jobId: 'job-1' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.versions).toEqual([{ screenId: 'lamps', versionId: 'version-1', name: 'Lamps', fixes: 2 }])
    expect(body.job).toMatchObject({ id: 'job-1', applied: { staged: ['lamps', 'about'], versions: { lamps: 'version-1' } } })
    const audit = [...mockDocs.entries()].find(([path]) => path.startsWith('adminAudit/'))?.[1]
    expect(audit).toMatchObject({
      action: 'ai.job.apply',
      actorUid: 'uid-editor',
      target: `orgs/${ORG}/aiJobs/job-1`,
      after: { hostId: HOST, versions: { lamps: 'version-1' }, staged: ['lamps', 'about'] },
    })
    expect(mockLogAiSeoApplied).toHaveBeenCalledWith(
      ORG,
      { uid: 'uid-editor', email: 'uid-editor@example.test' },
      { jobId: 'job-1', hostId: HOST, hostName: 'Acme Lamps', versions: 1, staged: 2 },
    )
  })
})
