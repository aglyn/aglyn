/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor (feedback_jest_environment_pragma_shadowed_by_license).
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
 * The staff churn report (AGL-2248, under AGL-1863 / AGL-1859 §3 step 1:
 * "a short why-are-you-leaving survey, STORED — it feeds the data loop").
 *
 * `orgs/{orgId}/retention` had FIVE writers and no reader. The survey was
 * stored exactly as specified and no surface, export or query anywhere read
 * it: the collection is Admin-SDK-only by construction, GA4 deliberately
 * carries only the closed-set counts and never the prose, and the prose is in
 * Firestore. A step that stores and is never read makes the data loop
 * worthless, which is the failure this route closes.
 *
 * The bucket keys are the sharp edge here, and the reason the last describe
 * block exists: the report keys on `kind` strings the three write routes emit
 * and NOTHING checks a mismatch at runtime. A reader keyed on a value nobody
 * writes reports ZERO — indistinguishable from "nobody cancelled", and the
 * most flattering possible way to be wrong.
 */

export {}

const mockVerifyIdToken = jest.fn()

/**
 * The fake collection group: one flat list of documents, since that is
 * precisely what a `collectionGroup(...).limit(n).get()` returns.
 *
 * Every helper the hoisted `jest.mock` factory reaches for is `mock`-prefixed
 * — babel-jest rejects any other out-of-scope identifier, and the whole suite
 * then fails to TRANSFORM, which looks a great deal like a suite that passed.
 */
let mockGroupDocs: Array<Record<string, unknown>> = []
/**
 * The `churnSurveyDetails` collection group (AGL-2294) — a SECOND flat list,
 * because it is a second scan.
 *
 * Kept separate rather than tagged into `mockGroupDocs` on purpose: the route
 * reads two different collection groups and a double that served one list to
 * both would make a route reading the wrong group look right.
 */
let mockDetailDocs: Array<Record<string, unknown>> = []
/** The limit the route asked for, so the cap can be asserted as WIRED. */
let mockRequestedLimit: number | null = null
/** Same, for the free-text scan — it must be capped too. */
let mockDetailRequestedLimit: number | null = null

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collectionGroup: (name: string) => ({
          limit: (count: number) => {
            if (name === 'churnSurveyDetails') mockDetailRequestedLimit = count
            else mockRequestedLimit = count
            return {
              get: async () => {
                // The double honours the limit. A double that ignored it
                // would make `capped` untestable and would quietly bless a
                // route that read the whole collection on every staff page
                // load.
                const source =
                  name === 'churnSurveyDetails'
                    ? mockDetailDocs
                    : name === 'retention'
                      ? mockGroupDocs
                      : []
                const docs = source.slice(0, count).map((data, index) => ({
                  // The detail document SHARES the survey's id (AGL-1978), and
                  // the join in the route is by that id — so the double has to
                  // let a fixture set it. A double that minted its own would
                  // make every join miss and the route would still look like
                  // it returned comments.
                  id: String(data['$id'] ?? `doc-${index}`),
                  exists: true,
                  data: () => data,
                  get: (field: string) => data[field],
                }))
                return { size: docs.length, empty: docs.length === 0, docs }
              },
            }
          },
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: undefined,
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
}))

import {
  CHURN_SURVEY_REASONS,
  RETENTION_KINDS,
  RETENTION_SURFACES,
} from '../app/api/_lib/retention'
import {
  CHURN_REPORT_COMMENT_LIMIT,
  CHURN_REPORT_SCAN_LIMIT,
  GET,
} from '../app/api/admin/churn-report/route'

/** One survey document as the funnel's own route writes it. */
function survey(
  reason: string,
  surface: string = RETENTION_SURFACES[0],
  plan: string | null = 'pro',
): Record<string, unknown> {
  return { kind: RETENTION_KINDS.survey, reason, surface, plan, uid: 'u-1' }
}

async function call(
  token: string | null = 'staff-token',
): Promise<Response> {
  return GET(
    new Request('https://app.aglyn.com/api/admin/churn-report', {
      method: 'GET',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    }),
  )
}

beforeEach(() => {
  mockGroupDocs = []
  mockDetailDocs = []
  mockRequestedLimit = null
  mockDetailRequestedLimit = null
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
})

describe('/api/admin/churn-report — who may read it (AGL-2248)', () => {
  it('answers 401 unauthenticated', async () => {
    expect((await call(null)).status).toBe(401)
  })

  it('answers 403 to a signed-in NON-staff caller', async () => {
    // These are other people's stated reasons for leaving. No org-scoped
    // permission opens them, which is why the collection has no client rule.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-1',
      email_verified: true,
      staff: false,
    })
    const response = await call()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('Staff only')
  })

  it('never reads the collection for a caller it refused', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
    mockGroupDocs = [survey('too_expensive')]
    await call()
    // The gate is ahead of the query, not beside it.
    expect(mockRequestedLimit).toBeNull()
  })

  it('is GET only', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/admin/churn-report', {
        method: 'POST',
        headers: { authorization: 'Bearer staff-token' },
      }),
    )
    expect(response.status).toBe(405)
  })
})

describe('the survey breakdown (AGL-2248)', () => {
  it('counts by reason, and a reason nobody chose reads 0 rather than absent', async () => {
    mockGroupDocs = [
      survey('too_expensive'),
      survey('too_expensive'),
      survey('missing_features'),
    ]
    const body = await (await call()).json()

    expect(body.surveys).toBe(3)
    expect(body.byReason.too_expensive).toBe(2)
    expect(body.byReason.missing_features).toBe(1)
    // Every closed-set key present. A breakdown with holes in it forces the
    // reader to guess whether a missing reason means zero or means broken.
    for (const reason of CHURN_SURVEY_REASONS) {
      expect(body.byReason[reason]).toBeGreaterThanOrEqual(0)
    }
    expect(Object.keys(body.byReason).sort()).toEqual(
      [...CHURN_SURVEY_REASONS].sort(),
    )
  })

  it('separates the two surfaces — counting one understates churn', async () => {
    mockGroupDocs = [
      survey('not_using_enough', 'subscription_cancel'),
      survey('not_using_enough', 'account_delete'),
      survey('other', 'account_delete'),
    ]
    const body = await (await call()).json()
    expect(body.bySurface.subscription_cancel).toBe(1)
    expect(body.bySurface.account_delete).toBe(2)
  })

  it('counts by the tier the org was ON — the first question anyone asks', async () => {
    mockGroupDocs = [
      survey('too_expensive', 'subscription_cancel', 'pro'),
      survey('too_expensive', 'subscription_cancel', 'starter'),
      survey('other', 'account_delete', null),
    ]
    const body = await (await call()).json()
    expect(body.byPlan).toEqual({ pro: 1, starter: 1, unknown: 1 })
  })

  it('NEGATIVE CONTROL: an out-of-set reason invents no column, and is still counted as a survey', async () => {
    // The write route validates against the same closed set, so this can only
    // happen if the set changed under stored data — in which case the answer
    // must not vanish from the total.
    mockGroupDocs = [survey('vibes'), survey('too_expensive')]
    const body = await (await call()).json()
    expect(body.surveys).toBe(2)
    expect(body.byReason).not.toHaveProperty('vibes')
    expect(body.byReason.too_expensive).toBe(1)
  })
})

describe('departures and offers (AGL-2248)', () => {
  it('splits the cancels that never saw the survey from the ones that did', async () => {
    mockGroupDocs = [
      { kind: RETENTION_KINDS.cancel, funnelSkipped: false },
      { kind: RETENTION_KINDS.cancel, funnelSkipped: true },
      { kind: RETENTION_KINDS.deleteRequested, funnelSkipped: true },
    ]
    const body = await (await call()).json()
    // Both leave paths are departures; counting only the subscription one
    // understates churn by exactly the orgs that chose the other.
    expect(body.cancels).toEqual({ total: 3, funnelSkipped: 2 })
  })

  it('separates a winback RESERVED from one actually applied', async () => {
    // The reservation is taken before Stripe and released on failure, so the
    // two numbers differing is a real signal, not noise.
    mockGroupDocs = [
      { kind: RETENTION_KINDS.winbackReserved },
      { kind: RETENTION_KINDS.winbackApplied },
      { kind: RETENTION_KINDS.winbackApplied },
    ]
    const body = await (await call()).json()
    expect(body.winbacks).toEqual({ reserved: 3, applied: 2 })
  })

  it('an empty collection is a report of zeros, not an error', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.surveys).toBe(0)
    expect(body.scanned).toBe(0)
    expect(body.capped).toBe(false)
  })
})

describe('the scan is capped, and SAYS SO (AGL-2248)', () => {
  it('asks the database for the cap rather than for everything', async () => {
    await call()
    expect(mockRequestedLimit).toBe(CHURN_REPORT_SCAN_LIMIT)
  })

  it('reports `capped` when the ceiling is reached', async () => {
    mockGroupDocs = Array.from({ length: CHURN_REPORT_SCAN_LIMIT + 5 }, () =>
      survey('too_expensive'),
    )
    const body = await (await call()).json()
    // An aggregate that quietly summarises an arbitrary slice reads like a
    // total. The flag is what stops the number from lying by omission.
    expect(body.capped).toBe(true)
    expect(body.scanned).toBe(CHURN_REPORT_SCAN_LIMIT)
    expect(body.surveys).toBe(CHURN_REPORT_SCAN_LIMIT)
  })

  it('NEGATIVE CONTROL: a scan under the ceiling is NOT flagged capped', async () => {
    mockGroupDocs = [survey('other')]
    const body = await (await call()).json()
    expect(body.capped).toBe(false)
    expect(body.scanned).toBe(1)
  })
})

/**
 * ⚠️ THE CONTROL THIS FILE MOST NEEDS.
 *
 * Every assertion above feeds the route documents built from
 * `RETENTION_KINDS` — so they all pass just as happily if the report keys on
 * a string the WRITE routes never emit. That is not hypothetical: the first
 * draft of this route bucketed `'org_delete_requested'` while
 * `api/orgs/delete/route.ts` writes `'delete_requested'`, and every deletion
 * would have been counted as nothing at all while the report looked healthy.
 *
 * The kinds are now one shared constant, which makes a rename a compile
 * error. This block is the assertion that the constant is EXHAUSTIVE — that
 * no kind the funnel writes falls through the report uncounted.
 */
describe('no retention document falls through the report (AGL-2248)', () => {
  it('every kind the funnel writes lands in exactly one bucket', async () => {
    mockGroupDocs = Object.values(RETENTION_KINDS).map((kind) => ({
      kind,
      reason: 'other',
      surface: 'subscription_cancel',
      plan: 'pro',
      funnelSkipped: false,
    }))
    const body = await (await call()).json()

    expect(body.scanned).toBe(Object.keys(RETENTION_KINDS).length)
    // Sum of the buckets must reconstruct the scan. A kind added to the
    // funnel and not to the report breaks this; so does one counted twice.
    expect(
      body.surveys + body.cancels.total + body.winbacks.reserved,
    ).toBe(body.scanned)
  })

  it('NEGATIVE CONTROL: a document of an UNKNOWN kind is counted nowhere', async () => {
    // The reconstruction above must be able to fail. A report that swept
    // unknown documents into some bucket would satisfy the sum forever.
    mockGroupDocs = [{ kind: 'something_new' }, survey('other')]
    const body = await (await call()).json()
    expect(body.scanned).toBe(2)
    expect(
      body.surveys + body.cancels.total + body.winbacks.reserved,
    ).toBe(1)
  })
})

/**
 * THE FREE TEXT HAS A READER (AGL-2294).
 *
 * AGL-2248 gave `orgs/{orgId}/retention` its first reader and left the prose
 * behind, on the argument that "a rate report is not what anyone reads prose
 * for". Right about the rate report — and nothing else read it either.
 * `orgs/{orgId}/churnSurveyDetails` had one writer, no reader anywhere in the
 * product, and a 365-day TTL, so every sentence a departing customer typed was
 * deleted unread.
 *
 * These assertions drive the ROUTE, not the estimator: a report that returned
 * a fixed comment, or that scanned the wrong collection group, is red below.
 * The join is the sharp edge — the detail document shares the survey's id by
 * design, so a route that minted its own key would return prose with no reason
 * attached and look almost right.
 */
describe('the free-text answers (AGL-2294)', () => {
  /** A detail document as `/api/billing/retention` writes it, id and all. */
  function detail(
    id: string,
    text: string,
    atMs: number | null = 1_760_000_000_000,
  ): Record<string, unknown> {
    return {
      $id: id,
      detail: text,
      ...(atMs === null
        ? {}
        : { createdAt: { toMillis: () => atMs } }),
    }
  }

  it('returns what the customer actually typed, joined to their reason', async () => {
    mockGroupDocs = [survey(CHURN_SURVEY_REASONS[1], RETENTION_SURFACES[0], 'business')]
    // `doc-0` is the id the double mints for the first retention row, so this
    // detail belongs to that survey — the join the route performs.
    mockDetailDocs = [detail('doc-0', 'Your form builder lost my fields twice.')]

    const payload = await (await call()).json()
    expect(payload.comments).toHaveLength(1)
    // The VALUE, not merely a non-empty array: a route returning a constant,
    // or the survey's own fields, cannot produce this sentence.
    expect(payload.comments[0]).toMatchObject({
      id: 'doc-0',
      detail: 'Your form builder lost my fields twice.',
      reason: CHURN_SURVEY_REASONS[1],
      surface: RETENTION_SURFACES[0],
      plan: 'business',
      atMs: 1_760_000_000_000,
    })
  })

  it('carries EACH comment’s own text — not the first one repeated', async () => {
    mockGroupDocs = [
      survey(CHURN_SURVEY_REASONS[0]),
      survey(CHURN_SURVEY_REASONS[2]),
    ]
    mockDetailDocs = [
      detail('doc-0', 'Too expensive for one site.', 1_000),
      detail('doc-1', 'Moving to an in-house build.', 2_000),
    ]

    const payload = await (await call()).json()
    // Newest first, and each row's prose and reason are its own. A map that
    // reused one context, or a sort that ignored the timestamp, is red.
    expect(payload.comments.map((row: any) => row.detail)).toEqual([
      'Moving to an in-house build.',
      'Too expensive for one site.',
    ])
    expect(payload.comments.map((row: any) => row.reason)).toEqual([
      CHURN_SURVEY_REASONS[2],
      CHURN_SURVEY_REASONS[0],
    ])
  })

  it('keeps a comment whose survey fell outside the scan, with null context', async () => {
    // The OLDEST prose is exactly what a 365-day window exists to preserve, so
    // dropping an unjoinable detail would silently hide the half that matters
    // most. It appears, and says it does not know the reason.
    mockGroupDocs = []
    mockDetailDocs = [detail('orphan-1', 'Nobody ever replied to my ticket.')]

    const payload = await (await call()).json()
    expect(payload.comments).toHaveLength(1)
    expect(payload.comments[0]).toMatchObject({
      detail: 'Nobody ever replied to my ticket.',
      reason: null,
      surface: null,
      plan: null,
    })
  })

  it('NEGATIVE CONTROL: a detail document with no prose is not a comment', async () => {
    // The writer only creates one when the trimmed text is non-empty, so these
    // should not exist — and if one ever does, it must not consume a slot in
    // a capped list or render as a blank row somebody has to interpret.
    mockGroupDocs = [survey(CHURN_SURVEY_REASONS[0])]
    mockDetailDocs = [
      detail('doc-0', ''),
      // No `detail` field at all — the other way the document can be empty.
      { $id: 'doc-1', createdAt: { toMillis: () => 1 } },
    ]
    const payload = await (await call()).json()
    expect(payload.comments).toEqual([])
    // …and the survey it belonged to is still counted. A filter that dropped
    // the SURVEY along with the empty prose would understate churn.
    expect(payload.surveys).toBe(1)
  })

  it('reads its OWN collection group, capped', async () => {
    // Asserted as WIRED. A route that scanned `retention` twice would still
    // return comments-shaped nothing, and a scan without a limit would read
    // every survey answer on the platform on each staff page load.
    mockGroupDocs = [survey(CHURN_SURVEY_REASONS[0])]
    mockDetailDocs = [detail('doc-0', 'A sentence.')]
    await call()
    expect(mockDetailRequestedLimit).toBe(CHURN_REPORT_SCAN_LIMIT)
    expect(mockRequestedLimit).toBe(CHURN_REPORT_SCAN_LIMIT)
  })

  it('returns at most CHURN_REPORT_COMMENT_LIMIT, and says when there are more', async () => {
    mockDetailDocs = Array.from(
      { length: CHURN_REPORT_COMMENT_LIMIT + 25 },
      (_unused, index) => detail(`d-${index}`, `answer ${index}`, index),
    )
    const payload = await (await call()).json()
    expect(payload.comments).toHaveLength(CHURN_REPORT_COMMENT_LIMIT)
    // Newest first, so the cap keeps the RECENT ones — a cap that kept the
    // oldest would quietly show a year-old page forever.
    expect(payload.comments[0].detail).toBe(
      `answer ${CHURN_REPORT_COMMENT_LIMIT + 24}`,
    )
    // Under the SCAN ceiling, so this slice is not the capped-scan flag.
    expect(payload.commentsCapped).toBe(false)
  })

  it('flags commentsCapped when the free-text scan hits the ceiling', async () => {
    mockDetailDocs = Array.from({ length: CHURN_REPORT_SCAN_LIMIT + 1 }, (_u, i) =>
      detail(`d-${i}`, `answer ${i}`, i),
    )
    const payload = await (await call()).json()
    expect(payload.commentsCapped).toBe(true)
  })

  it('NEGATIVE CONTROL: no detail documents means an empty list, not an error', async () => {
    mockGroupDocs = [survey(CHURN_SURVEY_REASONS[0])]
    const response = await call()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.comments).toEqual([])
    expect(payload.commentsCapped).toBe(false)
  })
})
