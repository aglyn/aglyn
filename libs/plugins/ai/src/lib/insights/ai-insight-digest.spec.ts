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
import type { AiInsight, AiInsightTable } from '../model/ai-insight'
import {
  AI_INSIGHT_DIGEST_MARKERS,
  AI_INSIGHT_DIGEST_MAX_ROWS,
  AI_INSIGHT_DIGEST_MIN_VIEWS,
  AI_INSIGHT_DIGEST_QUEUE,
  aiInsightDigestEmailHtml,
  aiInsightDigestEmailParts,
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
/** The Monday-to-Sunday week before that Monday. */
const WEEK = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']

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

const COLORS = {
  text: '#111111',
  muted: '#555555',
  border: '#dddddd',
  surface: '#f5f5f5',
  accent: '#00aaff',
  link: '#0066cc',
  up: '#008800',
  down: '#cc0000',
}

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
    colors: () => COLORS,
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
  for (const day of WEEK) mockDocs.set(`hosts/host-1/analytics/${day}`, { total: 10 })
})

describe('Monday', () => {
  it('makes no job for a week too quiet to explain, and says so in the marker', async () => {
    for (const day of WEEK) mockDocs.set(`hosts/host-1/analytics/${day}`, { total: 1 })
    const report = await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })
    expect(report).toMatchObject({ created: 0, done: true })
    expect(mockCreated).toEqual([])
    expect(mockDocs.get(`orgs/org-1/${AI_INSIGHT_DIGEST_MARKERS}/2026-W38`)?.['sites']).toEqual({
      'host-1': { jobId: '', name: 'Acme Roofing', state: 'quiet' },
    })
    expect(mockDocs.get(`${AI_INSIGHT_DIGEST_QUEUE}/2026-W38`)).toBeUndefined()
  })

  it('counts the whole week, and makes a job at the threshold', async () => {
    for (const day of WEEK) mockDocs.set(`hosts/host-1/analytics/${day}`, { total: 0 })
    mockDocs.set(`hosts/host-1/analytics/${WEEK[2]}`, { total: AI_INSIGHT_DIGEST_MIN_VIEWS })
    expect((await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })).created).toBe(1)
  })

  it('delivers nothing for a quiet site, and leaves the rest of the workspace alone', async () => {
    mockDocs.set('hosts/host-2', { orgId: 'org-1', displayName: 'Acme Blog', subdomain: 'blog' })
    await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })
    expect(mockCreated.map((job) => job['hostId'])).toEqual(['host-1'])
    expect(mockDocs.get(`orgs/org-1/${AI_INSIGHT_DIGEST_MARKERS}/2026-W38`)?.['sites']).toMatchObject({
      'host-1': { state: 'pending' },
      'host-2': { state: 'quiet' },
    })
  })

  it('makes one digest a site for the people who asked, once a week', async () => {
    const report = await runAiInsightDigestSweep(deps(MONDAY), { cursor: null })
    expect(report).toMatchObject({ week: '2026-W38', swept: 1, created: 1, done: true })
    expect(mockCreated).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'insight',
        brief: 'Weekly insights for Acme Roofing',
        // The week before that Monday, which the free Weekly summary reports too.
        inputs: { surface: 'digest', week: '2026-W38', through: '2026-09-13' },
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

  it('stops a chunk that runs out of time where it stopped, and the next call resumes there', async () => {
    const spent = await runAiInsightDigestSweep(deps(MONDAY, { budgetMs: -1 }), { cursor: 'org-0' })
    expect(spent).toMatchObject({ created: 0, nextCursor: 'org-0', done: false })
    const resumed = await runAiInsightDigestSweep(deps(MONDAY), { cursor: spent.nextCursor })
    expect(resumed).toMatchObject({ created: 1, done: true })
  })

  it('makes nothing on any other day', async () => {
    expect((await runAiInsightDigestSweep(deps(TUESDAY), { cursor: null })).created).toBe(0)
  })
})

describe('the email’s body (AGL-4130)', () => {
  const table = (patch: Partial<AiInsightTable>) =>
    ({ days: 7, scope: 'site', source: { label: 'Analytics', path: 'analytics' }, period: null, omitted: 0, notes: [], ...patch }) as AiInsightTable
  const TRAFFIC = table({
    ref: 't1',
    reader: 'digestspec.traffic',
    title: 'Traffic',
    columns: [{ key: 'figure', label: 'Figure', kind: 'text' }],
    rows: [{ figure: 'Visitors' }],
  })
  const PAGES = table({
    ref: 't2',
    reader: 'digestspec.pages',
    title: 'Top pages',
    columns: [
      { key: 'page', label: 'Page', kind: 'text' },
      { key: 'views', label: 'Views', kind: 'count' },
      { key: 'share', label: 'Share of views', kind: 'percent' },
      { key: 'change', label: 'Change', kind: 'change' },
    ],
    rows: [
      { page: '/', views: 181, share: 25.4, change: -1.1 },
      { page: '/pricing', views: 95, share: 13.3, change: 86.3 },
      { page: '/a', views: 9, share: 1, change: 2 },
      { page: '/b', views: 8, share: 1, change: 3 },
      { page: '/c', views: 7, share: 1, change: 4 },
      { page: '/d', views: 6, share: 1, change: 5 },
    ],
  })
  const DAYS = table({
    ref: 't3',
    reader: 'traffic.daily',
    title: 'Traffic by day',
    columns: [
      { key: 'day', label: 'Day', kind: 'date' },
      { key: 'views', label: 'Page views', kind: 'count' },
    ],
    rows: [
      { day: '2026-10-26', views: 161 },
      { day: '2026-10-27', views: 78 },
    ],
  })
  const FORMS = table({
    ref: 't4',
    reader: 'digestspec.forms',
    title: 'Forms',
    source: { label: 'Forms', path: 'forms' },
    columns: [
      { key: 'form', label: 'Form', kind: 'text' },
      { key: 'views', label: 'Views', kind: 'count' },
      { key: 'submissions', label: 'Submissions', kind: 'count' },
      { key: 'completion', label: 'Views that became a submission', kind: 'percent' },
    ],
    rows: [{ form: 'Contact', views: 14, submissions: 3, completion: 21.4 }],
  })
  const TABLES = [TRAFFIC, PAGES, DAYS, FORMS]
  const said = (text: string, ref: string, rows: number[] = [0], headline?: string): AiInsight => ({
    ...(headline ? { headline } : {}),
    text,
    cites: [{ table: ref, rows }],
  })
  const email = (
    insights: AiInsight[],
    tables: readonly AiInsightTable[] = TABLES,
    extra: { overview?: string | null; gap?: string | null } = {},
  ) =>
    aiInsightDigestEmailHtml({
      ...extra,
      insights,
      tables,
      colors: COLORS,
      siteUrl: 'https://acme.com',
      sourceUrl: (source) => `https://app.example.com/${source.source.path}`,
      why: 'Writing these used 17 credits.',
      settingsUrl: 'https://app.example.com/manage/notifications',
    })
  const html = (insights: AiInsight[], tables?: readonly AiInsightTable[]) => email(insights, tables)['digest.html']

  it('opens with the week in short, then a block for each insight', () => {
    const body = email([said('The home page led.', 't2')], TABLES, { overview: 'A busier week, mostly from search.' })['digest.html']
    expect(body.indexOf('The week in short')).toBeLessThan(body.indexOf('A busier week, mostly from search.'))
    expect(body.indexOf('A busier week, mostly from search.')).toBeLessThan(body.indexOf('The home page led.'))
  })

  it('opens with the insights on an answer from before it wrote an overview', () => {
    const body = html([said('The home page led.', 't2')])
    expect(body).not.toContain('The week in short')
    expect(body).toContain('The home page led.')
  })

  it('carries no tiles, no chart and no topic headings: the free email lists the figures', () => {
    const body = html([said('The home page led.', 't2'), said('Monday led.', 't3', [0])])
    expect(body).not.toContain('Top pages')
    expect(body).not.toContain('Traffic by day')
    expect(body).not.toContain('Mon, Oct 26')
    expect(body).not.toContain('border-radius:8px')
  })

  it('gives each insight its likely reason and its next step, linked to the report', () => {
    const insight = { ...said('Pricing grew.', 't4', [0]), why: 'Likely the Contact page published Monday.', next: 'Add a form to the page.' }
    const body = html([insight])
    expect(body).toContain('Likely why:')
    expect(body).toContain('Likely the Contact page published Monday.')
    expect(body).toContain('Try this:')
    expect(body).toContain('Add a form to the page.')
    expect(body).toContain('href="https://app.example.com/forms"')
    expect(body.indexOf('Likely why:')).toBeLessThan(body.indexOf('Try this:'))
    expect(body.indexOf('Try this:')).toBeLessThan(body.indexOf('14 views'))
  })

  it('draws no reason line and no link for an insight without them', () => {
    const body = html([said('x', 't4')])
    expect(body).not.toContain('Likely why:')
    expect(body).not.toContain('Try this:')
    expect(body).not.toContain('https://app.example.com/forms')
  })

  it('puts what the figures could not answer in small print under the insights', () => {
    const body = email([said('The home page led.', 't2')], TABLES, { gap: 'No campaign ran.' })['digest.html']
    expect(body.indexOf('The home page led.')).toBeLessThan(body.indexOf('No campaign ran.'))
    expect(body).toContain('font-size:13px')
  })

  it('lists each cited row once, in the order cited, and no more than three', () => {
    const body = html([said('One.', 't2', [1, 0, 1, 2, 3, 4])])
    expect(body.match(/>\/pricing</g)).toHaveLength(1)
    expect(body.indexOf('>/pricing<')).toBeLessThan(body.indexOf('>Home<'))
    expect(body).toContain('>/a<')
    expect(body).not.toContain('>/b<')
    expect(AI_INSIGHT_DIGEST_MAX_ROWS).toBe(3)
  })

  it('takes its rows from the first cited table that has any', () => {
    const insight: AiInsight = {
      text: 'Pricing grew.',
      cites: [
        { table: 't3', rows: [0] },
        { table: 't2', rows: [1] },
      ],
    }
    expect(html([insight])).toContain('95 views')
  })

  it('leaves the column’s word off a row that names its own figure', () => {
    const traffic = {
      ref: 't1',
      title: 'Traffic',
      source: { label: 'Analytics', path: 'analytics' },
      scope: 'site',
      reader: 'digestspec.none',
      columns: [
        { key: 'figure', label: 'Figure', kind: 'text' },
        { key: 'current', label: 'This window', kind: 'count' },
        { key: 'change', label: 'Change', kind: 'change' },
      ],
      rows: [{ figure: 'Visitors', current: 642, change: 22.5 }],
    } as unknown as AiInsightTable
    const body = html([said('x', 't1', [0])], [traffic])
    expect(body).toContain('642')
    expect(body).not.toContain('this window')
  })

  it('links each page it lists to the page itself, the home page as Home', () => {
    const body = html([said('x', 't2', [0, 1])])
    expect(body).toContain('href="https://acme.com"')
    expect(body).toContain('>Home<')
    expect(body).toContain('href="https://acme.com/pricing"')
  })

  it('shows a row’s figure with its change', () => {
    const body = html([said('x', 't2', [1])])
    expect(body).toContain('95 views')
    expect(body).toContain('▲ +86.3%')
  })

  it('shows two figures where the table has no change', () => {
    expect(html([said('x', 't4')])).toContain('14 views · 3 submissions')
  })

  it('leads a point with its headline', () => {
    const body = html([said('It came from search.', 't2', [0], 'Home page up 12%')])
    expect(body.indexOf('Home page up 12%')).toBeLessThan(body.indexOf('It came from search.'))
  })

  it('writes dates as a person says them', () => {
    expect(html([said('Monday 2026-10-26 was busiest.', 't2')])).toContain('Monday, Oct 26 was busiest.')
  })

  it('still draws an answer with no tables', () => {
    expect(html([said('Page views rose.', 't1')], [])).toContain('Page views rose.')
  })

  it('leaves out a cited row the table does not have', () => {
    expect(html([said('x', 't2', [99, 1])])).toContain('95 views')
  })

  it('says what it cost, and links the way out by name', () => {
    const footnote = email([said('x', 't2')])['digest.footnote']
    expect(footnote).toContain('Writing these used 17 credits.')
    expect(footnote).toContain('<a href="https://app.example.com/manage/notifications"')
    expect(footnote).toContain('Turn off weekly insights')
    const parts = aiInsightDigestEmailParts({
      siteName: 'Acme Roofing',
      productName: 'Aglyn',
      insights: [{ text: 'Page views rose 14.7%.' }],
      analyticsUrl: null,
      settingsUrl: 'https://app.example.com/manage/notifications',
      workspaceName: 'Acme Co',
      creditsSpent: 17,
    })
    expect(parts['digest.why']).toContain('17 of Acme Co’s AI credits')
    expect(parts['digest.why']).toContain("the AI's reading")
    expect(parts['digest.why']).not.toContain('https:')
  })

  it('says the same in plain text: the week in short, each reason and each next step', () => {
    const text = aiInsightDigestEmailText({
      siteName: 'Acme Roofing',
      productName: 'Aglyn',
      overview: 'A busier week, mostly from search.',
      insights: [{ headline: 'Pricing doubled', text: 'It rose into second place.', why: 'Likely the new page.', next: 'Link to it.' }],
      analyticsUrl: null,
      settingsUrl: null,
    })
    expect(text).toContain('The week in short: A busier week, mostly from search.')
    expect(text).toContain('1. Pricing doubled: It rose into second place.\nLikely why: Likely the new page.\nTry this: Link to it.')
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
    expect(sent[0].merge?.['digest.html']).toContain('Page views rose')
    expect(sent[0].merge?.['digest.footnote']).toContain('https://app.example.com/manage/notifications')
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

  // AGL-3432: the digest is an AI job metered against the workspace, and a
  // member of two workspaces cannot tell from "this workspace" which one.
  it('says what the digest drew and names the workspace it was asked for in', () => {
    const text = aiInsightDigestEmailText({
      siteName: 'Acme Roofing',
      productName: 'Aglyn',
      insights: [{ text: 'Page views rose 14.7%.' }],
      analyticsUrl: null,
      settingsUrl: null,
      workspaceName: 'Acme Co',
      creditsSpent: 4,
    })
    expect(text).toMatch(
      /^Here is what Acme Roofing's figures showed this week\. Writing it used 4 of Acme Co’s AI credits\.\n/,
    )
    expect(text).toContain('You asked for weekly insights for Acme Co.')
  })

  it('names the week the figures cover when it is told it (AGL-3867)', () => {
    const text = aiInsightDigestEmailText({
      siteName: 'Acme Roofing',
      productName: 'Aglyn',
      insights: [{ text: 'Page views rose 14.7%.' }],
      analyticsUrl: null,
      settingsUrl: null,
      periodLabel: 'Sep 7 – Sep 13',
    })
    expect(text).toMatch(/^Here is what Acme Roofing's figures showed last week, Sep 7 – Sep 13\.\n/)
  })

  it('gives up a digest parked for credits, silently', async () => {
    mockJobs.set('job-1', { $id: 'job-1', status: 'needs_input' })
    const report = await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON), { cursor: null })
    expect(report).toMatchObject({ delivered: 0, skipped: 1 })
    expect(mockCanceled).toEqual(['job-1'])
    expect(sent).toEqual([])
    expect(notified).toEqual([])
  })

  it('stops when the call runs out of time, and the next run sends what is left', async () => {
    mockJobs.set('job-1', { $id: 'job-1', status: 'done' })
    mockDocs.set('orgs/org-1/aiInsights/job-1', { insights: [{ text: 'Page views rose 14.7%.', cites: [] }] })
    const spent = await runAiInsightDigestSweep(deps(MONDAY_AFTERNOON, { budgetMs: -1 }), { cursor: null })
    expect(spent).toMatchObject({ deferred: true, delivered: 0 })
    expect(sent).toEqual([])
    await runAiInsightDigestSweep(deps(TUESDAY), { cursor: null })
    expect(sent).toHaveLength(1)
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
