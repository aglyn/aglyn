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
 * The chat's honest answers, from the REAL model (AGL-4075). The route's own
 * spec proves what the prompt says; this one asks ten questions through the
 * real route, the real prompt and the real provider, on a Free workspace with
 * one plan waiting and one teammate's build running, and holds each answer to
 * what the change is for: an answer in the asker's language grounded in the
 * English docs, no right-to-left claim, the plan by name, the media library
 * for a file, Confirm plan for the waiting plan, and no answer cut off.
 *
 * It calls the provider and costs real money (about $0.20 a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, and the
 * live launcher's mark so `jest.setup.js` keeps the key read from `.env`:
 *
 *   AGLYN_LIVE_AI=1 AGLYN_LIVE_AI_BATCH=0 AI_EVAL_LIVE=1 \
 *     AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts \
 *     --runInBand libs/plugins/ai/src/lib/server/assist-chat-honest-live.spec.ts
 *
 * Under the replay cache a question whose request was answered before is
 * replayed for nothing; `AGLYN_AI_REPLAY=refresh` asks every one again. Each
 * answer is printed in full, for a person to read as well as for the checks.
 */

import '../declarations'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0

const mockPlanEntitlements = jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')

function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else base[key] = value
  }
  return base
}

/** The route's Firestore in memory: documents, a collection query, transactions and batches. */
function mockMakeFirestore() {
  const snapshotOf = (path: string) => ({
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => (mockDocs.get(path) ?? {})[field],
  })
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
    update: async (data: Record<string, unknown>) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, true))
    },
  })
  const makeQuery = (
    prefix: string,
    filters: Array<(data: Record<string, unknown>) => boolean>,
    cap: number | null,
  ) => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery(
        prefix,
        [...filters, (data) => (op === 'in' ? (value as unknown[]).includes(data[field]) : data[field] === value)],
        cap,
      ),
    orderBy: () => makeQuery(prefix, filters, cap),
    limit: (count: number) => makeQuery(prefix, filters, count),
    select: () => makeQuery(prefix, filters, cap),
    get: async () => {
      const depth = prefix.split('/').length + 1
      const rows = [...mockDocs.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`) && path.split('/').length === depth)
        .filter(([, data]) => filters.every((keep) => keep(data)))
        .slice(0, cap ?? undefined)
      return { docs: rows.map(([path, data]) => ({ id: path.split('/').pop(), data: () => data })) }
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
    ...makeQuery(prefix, [], null),
  })
  const writer = () => {
    const queued: Array<() => void> = []
    return {
      queued,
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        queued.push(() => mockDocs.set(ref.path, applyData(mockDocs.get(ref.path), data, Boolean(options?.merge))))
      },
    }
  }
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const tx = writer()
      const result = await fn({ get: async (ref: { path: string }) => snapshotOf(ref.path), set: tx.set })
      for (const write of tx.queued) write()
      return result
    },
    batch: () => {
      const queue = writer()
      const batch = {
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          queue.set(ref, data, options)
          return batch
        },
        commit: async () => {
          for (const write of queue.queued) write()
        },
      }
      return batch
    },
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: mockPlanEntitlements.checkEntitlement,
  resolveBrandingProfile: mockPlanEntitlements.resolveBrandingProfile,
  PLATFORM_BRAND_NAME: jest.requireActual('@aglyn/aglyn/app-utils/platform-brand').PLATFORM_BRAND_NAME,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/assist-answer-cache'),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true, staff: false }),
        getUser: async () => ({ metadata: { creationTime: 'Thu, 13 Aug 2026 00:00:00 GMT' } }),
      }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: { FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' } },
  },
  authForPool: () => ({ getUser: async () => ({ metadata: { creationTime: 'Thu, 13 Aug 2026 00:00:00 GMT' } }) }),
  checkRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, resetMs: Date.now() + 60_000 }),
  rateLimitHeaders: () => ({}),
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgForUser: async (uid: string, orgId?: string | null) => {
    const org = mockDocs.get(`orgs/${orgId}`)
    return org ? { orgId, org, member: { $id: uid } } : null
  },
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  featureLockdownRefusal: async () => null,
  memberHasPermissionOnHost: async () => true,
  permissionRefusal: () => Response.json({ error: 'permission' }, { status: 403 }),
}))

const ORG = 'org-live'
const ROUTE = { route: '/acme/hosts/bakery/screens', hostId: 'host-live', orgSlug: 'acme' }

/** A Latin-script answer to an English question; a script's letters otherwise. */
const ARABIC = /[؀-ۿ]/
const HANGUL = /[가-힯]/
const KANA_OR_HAN = /[぀-ヿ一-鿿]/

interface LiveCase {
  id: string
  question: string
  /** What the answer must show it understood. */
  check: (answer: string, docs: string[]) => string | null
}

const LONG_QUESTION = [
  'I run a small bakery and I am setting up my first site.',
  'I want a home page, a menu page with prices, an about page with our story, and a contact page with a map.',
  'We also take custom cake orders, so I want a form where people pick a size, a flavor and a date, and I want to be told when one comes in.',
  'Later I would like to sell gift cards and maybe ship cookies, but not yet.',
  'Can you tell me, step by step, what I should set up first, what can wait, and where each part lives in the console?',
].join(' ').repeat(3)

const CASES: LiveCase[] = [
  {
    id: 'arabic-rtl',
    question: 'هل يمكنني جعل موقعي من اليمين إلى اليسار للغة العربية؟',
    check: (answer, docs) =>
      !ARABIC.test(answer)
        ? 'not answered in Arabic'
        : !docs.some((url) => url.includes('/multilingual/'))
          ? 'the multilingual docs were not found'
          : null,
  },
  {
    id: 'korean-domain',
    question: '사이트에 사용자 지정 도메인을 어떻게 연결하나요?',
    check: (answer, docs) =>
      !HANGUL.test(answer) ? 'not answered in Korean' : !docs.some((url) => url.includes('domain')) ? 'no domain docs' : null,
  },
  {
    id: 'spanish-publish',
    question: '¿Cómo publico mi página para que la vean mis clientes?',
    check: (answer, docs) =>
      !docs.length ? 'no docs found' : !/[áéíóúñ¿¡]|\b(?:la|el|tu|página)\b/i.test(answer) ? 'not answered in Spanish' : null,
  },
  {
    id: 'persian-ai-page',
    question: 'چطور یک صفحه جدید با هوش مصنوعی بسازم؟',
    check: (answer) => (!ARABIC.test(answer) ? 'not answered in Persian' : null),
  },
  {
    id: 'japanese-orders',
    question: '注文が入ったら、誰にメールで通知されますか？',
    check: (answer) => (!KANA_OR_HAN.test(answer) ? 'not answered in Japanese' : null),
  },
  {
    id: 'plan-name',
    question: 'What plan is my workspace on?',
    check: (answer) => (!/\bFree\b/.test(answer) ? 'did not name the Free plan' : null),
  },
  {
    id: 'send-logo',
    question: 'Can I send you my logo here so you can put it on my site?',
    check: (answer) => (!/media/i.test(answer) ? 'did not point to the Media page' : null),
  },
  {
    id: 'where-is-my-build',
    question: 'Where is my about page? Is it built yet?',
    check: (answer) => (!/confirm plan/i.test(answer) ? 'did not say the plan waits for Confirm plan' : null),
  },
  {
    id: 'arabic-plan',
    question: 'ما هي خطة مساحة العمل الخاصة بي؟',
    check: (answer) => (!ARABIC.test(answer) ? 'not answered in Arabic' : null),
  },
  { id: 'long-question', question: LONG_QUESTION, check: () => null },
]

const describeLive = LIVE ? describe : describe.skip

describeLive('the chat answers honestly, from the real model (AGL-4075)', () => {
  jest.setTimeout(10 * 60_000)

  it('answers every question in its own language, grounded, and never cut off', async () => {
    const { POST } = require('./assist-chat') as { POST: (request: Request) => Promise<Response> }
    const rows: Array<Record<string, unknown>> = []
    const failures: string[] = []
    for (const entry of CASES) {
      mockDocs = new Map()
      mockAutoId = 0
      mockDocs.set(`orgs/${ORG}`, { name: 'Acme Bakery', plan: 'free', slug: 'acme' })
      const hoursAgo = new Date(Date.now() - 26 * 3_600_000).toISOString()
      mockDocs.set(`orgs/${ORG}/aiJobs/job-about`, {
        kind: 'page',
        status: 'needs_review',
        review: { reason: 'plan' },
        hostId: 'host-live',
        createdBy: 'user-1',
        brief: 'An about page with our story and a photo of the team',
        steps: [{ name: 'plan', status: 'done' }, { name: 'generate', status: 'pending' }],
        createdAt: hoursAgo,
        updatedAt: hoursAgo,
      })
      mockDocs.set(`orgs/${ORG}/aiJobs/job-menu`, {
        kind: 'build',
        status: 'running',
        hostId: 'host-live',
        createdBy: 'user-2',
        brief: 'a teammate brief that must never reach the prompt',
        steps: [{ name: 'plan', status: 'done' }, { name: 'build', status: 'running' }],
        createdAt: hoursAgo,
        updatedAt: hoursAgo,
      })
      const response = await POST(
        new Request('https://app.aglyn.com/api/assist/chat', {
          method: 'POST',
          headers: { authorization: 'Bearer live', 'content-type': 'application/json' },
          body: JSON.stringify({ orgId: ORG, question: entry.question, history: [], context: ROUTE }),
        }),
      )
      const events = (await response.text())
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
      const answer = events
        .filter((event) => event.type === 'delta')
        .map((event) => String(event.text))
        .join('')
      const done = events.find((event) => event.type === 'done') as
        | { exchangeId: string; docs: Array<{ url: string }>; usage: Record<string, number> }
        | undefined
      const signal = done ? (mockDocs.get(`orgs/${ORG}/assistSignals/${done.exchangeId}`) ?? {}) : {}
      const docs = (done?.docs ?? []).map((doc) => doc.url)
      const stopReason = String(signal['stopReason'] ?? '')
      const problem =
        response.status !== 200
          ? `status ${response.status}`
          : stopReason === 'max_tokens'
            ? 'cut off at the ceiling'
            : /right[- ]to[- ]left (?:is|are) (?:supported|available)|supports right[- ]to[- ]left/i.test(answer)
              ? 'claimed right-to-left support'
              : entry.check(answer, docs)
      if (problem) failures.push(`${entry.id}: ${problem}`)
      rows.push({
        id: entry.id,
        stop: stopReason,
        in: done?.usage?.['inputTokens'],
        out: done?.usage?.['outputTokens'],
        docs: docs.length,
        verdict: problem ?? 'ok',
      })
      console.log(`── ${entry.id}\n${entry.question.slice(0, 200)}\n\n${answer}\n\nsources: ${docs.join(', ')}`)
    }
    console.table(rows)
    expect(failures).toEqual([])
  })
})

describe('the live chat check', () => {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(typeof LIVE).toBe('boolean')
  })
})
