/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * AGL-2252: the Assist data loop's read side, and the staff route that
 * serves it.
 *
 * Two halves, both of which have a way to be vacuously true and are written
 * against it:
 *
 *  - the ranking (`mineAssistSignals`) — a docs-gap list sorted by the wrong
 *    key still LOOKS like a gap list, and a cost column that adds up to
 *    something plausible is not the same as one that adds up the right
 *    documents. Every total here is asserted against arithmetic done by hand
 *    in the fixture, and the sort is asserted by constructing the case where
 *    volume and rating disagree.
 *  - the route — no token 401, a verified NON-staff token 403 with Firestore
 *    never touched, a staff token served. `assistSignals` is fleet-wide
 *    cross-tenant data with no rules coverage, so the claim is the whole
 *    gate and the 403 is the load-bearing case.
 */

const mockVerifyIdToken = jest.fn()
const mockSignalsGet = jest.fn()
const mockLimit = jest.fn(() => ({ get: () => mockSignalsGet() }))
const mockCollectionGroup = jest.fn(() => ({ limit: mockLimit }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collectionGroup: (...args: unknown[]) => mockCollectionGroup(...(args as [])),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { GET } from '../app/api/admin/assist-signals/route'
import {
  assistSignalRow,
  mineAssistSignals,
  type AssistSignalRow,
} from '../utils/assist-signal-mining'

const signal = (over: Partial<AssistSignalRow> = {}): AssistSignalRow => ({
  orgId: 'org-1',
  route: '/acme/hosts',
  model: 'claude-sonnet-5',
  tier: 'entitled',
  inputTokens: 100,
  outputTokens: 40,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  estCostUsd: 0.001,
  docsPaths: ['/building-sites/publish#steps'],
  stopReason: 'end_turn',
  feedback: null,
  ...over,
})

describe('mineAssistSignals — the docs-gap ranking (AGL-2252)', () => {
  it('ranks by thumbs-down first and volume second', () => {
    // Constructed so the two keys DISAGREE. `/popular` is cited four times
    // and rated down once; `/broken` twice and rated down twice. A ranking
    // on volume puts the popular page first and is a popularity list, not a
    // gap list — the failure this ordering exists to avoid, and one that no
    // fixture where the same page wins on both keys can detect.
    const report = mineAssistSignals([
      signal({ docsPaths: ['/popular'], feedback: 'down' }),
      signal({ docsPaths: ['/popular'], feedback: 'up' }),
      signal({ docsPaths: ['/popular'] }),
      signal({ docsPaths: ['/popular'] }),
      signal({ docsPaths: ['/broken'], feedback: 'down' }),
      signal({ docsPaths: ['/broken'], feedback: 'down' }),
    ])
    expect(report.docsGaps.map((row) => row.path)).toEqual([
      '/broken',
      '/popular',
    ])
    expect(report.docsGaps[0]).toMatchObject({
      path: '/broken',
      questions: 2,
      down: 2,
      up: 0,
      downRate: 1,
    })
    expect(report.docsGaps[1]).toMatchObject({
      path: '/popular',
      questions: 4,
      down: 1,
      up: 1,
      // Two ratings out of four questions: the rate is over what was RATED,
      // not over what was asked. Dividing by questions would make every
      // page's dissatisfaction look smaller the more it is used.
      downRate: 0.5,
    })
  })

  it('counts DISTINCT orgs, so one workspace cannot manufacture a gap', () => {
    const report = mineAssistSignals([
      signal({ orgId: 'org-1', docsPaths: ['/thin'], feedback: 'down' }),
      signal({ orgId: 'org-1', docsPaths: ['/thin'], feedback: 'down' }),
      signal({ orgId: 'org-1', docsPaths: ['/thin'], feedback: 'down' }),
      signal({ orgId: 'org-2', docsPaths: ['/shared'], feedback: 'down' }),
      signal({ orgId: 'org-3', docsPaths: ['/shared'], feedback: 'down' }),
    ])
    const byPath = new Map(report.docsGaps.map((row) => [row.path, row]))
    expect(byPath.get('/thin')).toMatchObject({ questions: 3, orgs: 1 })
    expect(byPath.get('/shared')).toMatchObject({ questions: 2, orgs: 2 })
  })

  it('counts a turn ONCE per path even when it cites the path twice', () => {
    // Retrieval can return two sections of the same page. One question is
    // one question, or a page with many headings outranks a page that is
    // actually failing people.
    const report = mineAssistSignals([
      signal({ docsPaths: ['/page#a', '/page#a', '/page#b'] }),
    ])
    const byPath = new Map(report.docsGaps.map((row) => [row.path, row]))
    expect(byPath.get('/page#a')?.questions).toBe(1)
    expect(byPath.get('/page#b')?.questions).toBe(1)
  })

  it('THE MISSING PAGE: an ungrounded question appears nowhere in the ranking', () => {
    // The sharpest gap signal and the one a path-keyed ranking structurally
    // cannot show: a question retrieval matched NOTHING for cites no path,
    // so it has nothing to rank under. If this ever starts appearing in
    // `docsGaps`, the ranking has invented a path that was never cited.
    const report = mineAssistSignals([
      signal({ docsPaths: [], route: '/acme/commerce', feedback: 'down' }),
      signal({ docsPaths: [], route: '/acme/commerce' }),
      signal({ docsPaths: [], route: '/acme/billing' }),
      signal({ docsPaths: ['/known'] }),
    ])
    expect(report.docsGaps.map((row) => row.path)).toEqual(['/known'])
    expect(report.ungrounded).toMatchObject({ questions: 3, down: 1 })
    // Reported BY ROUTE, so the gap arrives with the screen the person was
    // looking at — which is the half that makes it actionable.
    expect(report.ungrounded.routes).toEqual([
      { route: '/acme/commerce', questions: 2, down: 1 },
      { route: '/acme/billing', questions: 1, down: 0 },
    ])
  })

  it('rolls cost up per org, dearest first, and totals the fleet', () => {
    const report = mineAssistSignals([
      signal({ orgId: 'cheap', estCostUsd: 0.001, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }),
      signal({ orgId: 'dear', estCostUsd: 0.05, inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 }),
      signal({ orgId: 'dear', estCostUsd: 0.02, inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 }),
    ])
    expect(report.orgs.map((row) => row.orgId)).toEqual(['dear', 'cheap'])
    expect(report.orgs[0]).toMatchObject({
      orgId: 'dear',
      messages: 2,
      estCostUsd: 0.07,
      inputTokens: 200,
      outputTokens: 70,
      cacheReadTokens: 1800,
    })
    expect(report.totals).toMatchObject({
      messages: 3,
      inputTokens: 210,
      outputTokens: 75,
      cacheReadTokens: 1800,
    })
    expect(report.totals.estCostUsd).toBeCloseTo(0.071, 9)
    // Cache-read rate over BILLABLE prompt tokens (fresh input + cache
    // reads). This is the number that settles whether the assist system
    // prefix is caching at all — it measures 1,030–1,190 tokens against
    // Sonnet 5's 1,024-token minimum, so a prefix under the line caches
    // silently not at all and the bill is the only evidence.
    expect(report.totals.cacheReadRate).toBeCloseTo(1800 / (210 + 1800), 9)
  })

  it('reports zero-token traffic as an unknown cache rate, not as zero', () => {
    // A rate of 0 says "we asked and the cache never hit"; null says "there
    // is nothing to divide". Collapsing the second into the first is how a
    // dashboard shows a confident 0% for an empty fleet.
    expect(
      mineAssistSignals([
        signal({ inputTokens: 0, cacheReadTokens: 0 }),
      ]).totals.cacheReadRate,
    ).toBeNull()
    expect(mineAssistSignals([]).totals.cacheReadRate).toBeNull()
  })

  it('separates a refusal from a truncation, which need opposite fixes', () => {
    const report = mineAssistSignals([
      signal({ stopReason: 'refusal' }),
      signal({ stopReason: 'max_tokens' }),
      signal({ stopReason: 'max_tokens' }),
      signal({ stopReason: null }),
      signal({ tier: 'free', model: 'claude-haiku-4-5' }),
    ])
    expect(report.totals.stopReasons).toMatchObject({
      refusal: 1,
      max_tokens: 2,
      none: 1,
      end_turn: 1,
    })
    expect(report.totals.byTier).toMatchObject({ entitled: 4, free: 1 })
    expect(report.totals.byModel).toMatchObject({
      'claude-sonnet-5': 4,
      'claude-haiku-4-5': 1,
    })
  })

  it('carries truncation through instead of ranking a partial sample silently', () => {
    expect(mineAssistSignals([signal()], { truncated: true }).truncated).toBe(true)
    expect(mineAssistSignals([signal()]).truncated).toBe(false)
  })

  it('normalizes a signal written by an older build rather than dropping it', () => {
    // Evidence is evidence. Dropping under-specified documents would bias
    // every ranking toward whatever shipped most recently.
    const row = assistSignalRow('org-9', {})
    expect(row).toMatchObject({
      orgId: 'org-9',
      route: '',
      model: 'unknown',
      tier: 'unknown',
      inputTokens: 0,
      docsPaths: [],
      stopReason: null,
      feedback: null,
    })
    // And a rating that is neither literal reads as unrated, not as a third
    // kind of rating that would silently skew `downRate`.
    expect(assistSignalRow('org-9', { feedback: 'meh' }).feedback).toBeNull()
  })
})

describe('/api/admin/assist-signals authorization (AGL-2252)', () => {
  const get = (opts: { token?: string; limit?: string } = {}) =>
    GET(
      new Request(
        `https://app.aglyn.com/api/admin/assist-signals${opts.limit ? `?limit=${opts.limit}` : ''}`,
        { headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {} },
      ),
    )

  const doc = (orgId: string, data: Record<string, unknown>) => ({
    ref: { parent: { parent: { id: orgId } } },
    data: () => data,
  })

  beforeEach(() => jest.clearAllMocks())

  it('401s an unauthenticated caller', async () => {
    expect((await get()).status).toBe(401)
    expect(mockCollectionGroup).not.toHaveBeenCalled()
  })

  it('403s a verified NON-staff token, and never reaches Firestore', async () => {
    // The load-bearing case. This collection is fleet-wide, cross-tenant,
    // and has NO rules coverage by design — the staff claim is the entire
    // boundary, so a read that happened before the refusal would already be
    // the leak whatever status came back.
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u1', email_verified: true })
    expect((await get({ token: 'tok' })).status).toBe(403)
    expect(mockCollectionGroup).not.toHaveBeenCalled()
  })

  it('serves the ranking to a staff token, org derived from the parent path', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    mockSignalsGet.mockResolvedValueOnce({
      size: 2,
      docs: [
        doc('org-a', {
          route: '/a/hosts',
          model: 'claude-sonnet-5',
          tier: 'entitled',
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 900,
          cacheWriteTokens: 0,
          estCostUsd: 0.01,
          docsPaths: ['/publish#steps'],
          stopReason: 'end_turn',
          feedback: 'down',
        }),
        doc('org-b', {
          route: '/b/billing',
          model: 'claude-sonnet-5',
          tier: 'free',
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estCostUsd: 0.002,
          docsPaths: [],
          stopReason: 'end_turn',
          feedback: null,
        }),
      ],
    })
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(mockCollectionGroup).toHaveBeenCalledWith('assistSignals')
    // The org is the PARENT of the parent — the signal document carries no
    // identifier of its own (AGL-1972), so a projection that looked for an
    // `orgId` field would attribute every row on the platform to nobody.
    expect(payload.orgs.map((row: { orgId: string }) => row.orgId)).toEqual([
      'org-a',
      'org-b',
    ])
    expect(payload.docsGaps).toEqual([
      expect.objectContaining({ path: '/publish#steps', down: 1, orgs: 1 }),
    ])
    expect(payload.ungrounded).toMatchObject({ questions: 1 })
    expect(payload.truncated).toBe(false)
  })

  it('reports truncation when the read hits its ceiling', async () => {
    // The AGL-2220 shape: a ranking cut short looks exactly like a complete
    // one. The read asks for ceiling + 1 so the extra row is the evidence.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    const ceiling = 20000
    mockSignalsGet.mockResolvedValueOnce({
      size: ceiling + 1,
      docs: Array.from({ length: ceiling + 1 }, () =>
        doc('org-a', { docsPaths: ['/p'], estCostUsd: 0 }),
      ),
    })
    const payload = await (await get({ token: 'tok' })).json()
    expect(mockLimit).toHaveBeenCalledWith(ceiling + 1)
    expect(payload.truncated).toBe(true)
    // And the extra row is DROPPED rather than counted, so the numbers
    // describe exactly the sample that was ranked.
    expect(payload.scanned).toBe(ceiling)
  })

  it('clamps the requested row limit rather than trusting the query string', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    mockSignalsGet.mockResolvedValueOnce({
      size: 300,
      docs: Array.from({ length: 300 }, (_, index) =>
        doc(`org-${index}`, { docsPaths: [`/p${index}`], estCostUsd: index }),
      ),
    })
    const payload = await (await get({ token: 'tok', limit: '9999' })).json()
    expect(payload.orgs).toHaveLength(100)
    expect(payload.docsGaps).toHaveLength(100)
  })
})
