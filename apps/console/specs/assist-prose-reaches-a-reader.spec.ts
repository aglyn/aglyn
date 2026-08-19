/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * THE ASSIST CORPUS GETS A CONSUMER (AGL-2314).
 *
 * `recordAssistExchange` writes `orgs/{id}/assistExchanges/{id}` — uid,
 * question, answer, hostId, expiresAt — and `assist-usage.ts` calls it "the
 * VERBATIM half… the data loop's corpus". NO corpus consumer existed:
 * `git grep assistExchanges` over non-spec source returned exactly one
 * non-comment hit, that write. The only reachable reader was the DSAR
 * walker's blind `listCollections()` recursion, which is a dump, not a
 * product read.
 *
 * Meanwhile `legal-documents.ts` commits publicly to retaining `question`,
 * `answer` and `uid` for 180 days. So: retained personal data — questions
 * customers typed to an assistant — bought for zero product value, and a
 * promise in the privacy policy about a corpus nothing mined.
 *
 * ## Why a reader rather than deleting the write
 *
 * Both were on the table. Deleting it would need `legal-documents.ts` updated
 * in the same pass, and legal snapshots here are PUBLICATION-FIRST — besigner
 * content, published before the repo record changes — which is a different
 * kind of change from a code fix and not one to land unattended. Giving the
 * words a purpose makes the retention the policy already describes honest,
 * and it is reversible; publishing a corrected policy is not.
 *
 * ## WHAT THIS FILE HAS TO CATCH
 *
 * The whole chain is reachable from the console — `recordAssistExchange` is
 * exported through `@aglyn/tenant-data-admin`, which console code imports
 * everywhere — so every test drives the REAL writer and then the REAL route.
 *
 *  - EACH TURN'S OWN WORDS. Two failing turns with different questions, and
 *    each must come back carrying its own. A writer storing a constant, or a
 *    route joining every candidate to the first exchange it read, dies here.
 *  - ONLY THE TURNS THAT FAILED. A successful, grounded turn's prose must NOT
 *    be fetched. That is the privacy control, and a panel that read every
 *    exchange would be surveillance with a dashboard on it.
 *  - AN EXPIRED EXCHANGE IS AN ANSWER. The 180-day TTL means a signal can
 *    outlive its prose. Dropping those rows would make the shortlist quietly
 *    shorter than the failure count it came from.
 *  - THE UID STAYS OUT. The corpus question is what people asked, never who.
 */

const mockVerifyIdToken = jest.fn()

/** Every document, by path. The batch writes here; the route reads here. */
const mockStore: Record<string, Record<string, unknown>> = {}
/** Auto-doc ids, so two exchanges in one test do not collide. */
let mockAutoId = 0

interface FakeRef {
  path: string
  id: string
  collection: (name: string) => FakeCollection
}
interface FakeCollection {
  doc: (id?: string) => FakeRef
}

function ref(path: string): FakeRef {
  return {
    path,
    id: path.split('/').pop() ?? path,
    collection: (name: string) => collectionAt(`${path}/${name}`),
  }
}

function collectionAt(path: string): FakeCollection {
  return {
    doc: (id?: string) => ref(`${path}/${id ?? `auto-${++mockAutoId}`}`),
  }
}

/**
 * `FieldValue.increment` sentinels are stored as-is.
 *
 * The rollup writes them and nothing in this file reads a rollup, so
 * modelling the arithmetic would be modelling something no assertion
 * touches — and a double that pretended to increment would invite a later
 * test to trust a number it never actually computed.
 */
const fakeFirestore: any = {
  collection: (name: string) => ({
    ...collectionAt(name),
    // The admin queue's shape is not used here, but `getAll` needs refs built
    // the same way the route builds them.
  }),
  batch: () => ({
    set: (target: FakeRef, data: Record<string, unknown>) => {
      mockStore[target.path] = { ...(mockStore[target.path] ?? {}), ...data }
    },
    commit: async () => undefined,
  }),
  collectionGroup: (name: string) => ({
    limit: () => ({
      get: async () => {
        const docs = Object.entries(mockStore)
          .filter(([path]) => path.includes(`/${name}/`))
          .map(([path, data]) => ({
            id: path.split('/').pop(),
            data: () => data,
            ref: {
              parent: { parent: { id: path.split('/')[1] } },
            },
          }))
        return { docs, size: docs.length }
      },
    }),
  }),
  /**
   * `getAll` answers in ARGUMENT ORDER, including for documents that do not
   * exist.
   *
   * The route zips the results against its candidate list by index, so a
   * double that dropped missing documents — the real SDK does not — would
   * silently pair every question with the wrong turn and the "each turn's own
   * words" test would fail for a reason that has nothing to do with the code.
   */
  getAll: async (...refs: FakeRef[]) =>
    refs.map((target) => ({
      exists: mockStore[target.path] !== undefined,
      id: target.id,
      data: () => mockStore[target.path],
    })),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL writer. A stub would make this file assert that a mock agreed
  // with itself about what an exchange contains.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/assist-usage',
  ),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => fakeFirestore,
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
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { recordAssistExchange } from '@aglyn/tenant-data-admin'
import { GET } from '../app/api/admin/assist-signals/route'

const ORG = 'org-1'

/** Drive the REAL writer, and hand back the id both halves were written under. */
async function record(input: {
  question: string
  answer: string
  docsPaths?: string[]
}): Promise<string> {
  return recordAssistExchange(fakeFirestore, ORG, {
    uid: 'user-7',
    question: input.question,
    answer: input.answer,
    route: '/acme/screens',
    hostId: 'host-1',
    model: 'claude-sonnet-5',
    tier: 'entitled',
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
    },
    docsPaths: input.docsPaths ?? [],
    stopReason: 'end_turn',
  } as never)
}

/** The thumbs-down the feedback route writes onto the SIGNAL (AGL-1972). */
function rateDown(exchangeId: string) {
  const path = `orgs/${ORG}/assistSignals/${exchangeId}`
  mockStore[path] = { ...(mockStore[path] ?? {}), feedback: 'down' }
}

const mine = async () =>
  (
    await GET(
      new Request('https://app.aglyn.com/api/admin/assist-signals', {
        headers: { authorization: 'Bearer staff-token' },
      }),
    )
  ).json()

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockAutoId = 0
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'zach@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('the words behind a failing turn reach a staff reader', () => {
  it('carries EACH turn’s own question, end to end', async () => {
    // Two ungrounded turns — retrieval matched nothing, so both qualify —
    // with questions that share no words. A route that joined every candidate
    // to the first exchange it read passes only one of these lines.
    const first = await record({
      question: 'Where do I set a custom domain for a second site?',
      answer: 'Open Setup, then Domains.',
    })
    const second = await record({
      question: 'Can a form email two different addresses?',
      answer: 'Add a second notification recipient.',
    })
    expect(first).not.toBe(second)

    const body = await mine()
    const byId = Object.fromEntries(
      body.prose.map((row: any) => [row.exchangeId, row]),
    )
    expect(byId[first].question).toBe(
      'Where do I set a custom domain for a second site?',
    )
    expect(byId[second].question).toBe(
      'Can a form email two different addresses?',
    )
    // The answer rides along, so a reviewer can judge whether it was wrong.
    expect(byId[first].answer).toBe('Open Setup, then Domains.')
  })

  it('does NOT read the prose of a turn that went fine', async () => {
    // The privacy control, and the one that keeps this a corpus rather than
    // surveillance: a grounded, unrated turn is never fetched.
    const failing = await record({
      question: 'Why is my invoice higher than last month?',
      answer: 'Storage overage.',
    })
    const fine = await record({
      question: 'How do I publish?',
      answer: 'Press Publish.',
      docsPaths: ['/building-sites/publish#steps'],
    })

    const body = await mine()
    const ids = body.prose.map((row: any) => row.exchangeId)
    expect(ids).toContain(failing)
    expect(ids).not.toContain(fine)
  })

  it('includes a RATED-DOWN turn even when it was grounded', async () => {
    // A wrong answer with citations is the most valuable row in the corpus:
    // the counts say the page was cited, and only the words say why it did
    // not help.
    const rated = await record({
      question: 'The publish button does nothing on my phone.',
      answer: 'Try again later.',
      docsPaths: ['/building-sites/publish#steps'],
    })
    rateDown(rated)

    const body = await mine()
    const row = body.prose.find((entry: any) => entry.exchangeId === rated)
    expect(row).toMatchObject({
      feedback: 'down',
      grounded: true,
      question: 'The publish button does nothing on my phone.',
    })
  })

  it('reports an EXPIRED exchange rather than dropping the row', async () => {
    // The 180-day TTL means a signal outlives its prose, by design. A
    // shortlist quietly shorter than the failure count it came from would
    // read as "these are all the failures".
    const gone = await record({
      question: 'This will be reaped.',
      answer: 'So will this.',
    })
    delete mockStore[`orgs/${ORG}/assistExchanges/${gone}`]

    const body = await mine()
    const row = body.prose.find((entry: any) => entry.exchangeId === gone)
    expect(row).toMatchObject({ expired: true, question: null })
  })

  it('never serves the asker’s uid', async () => {
    // The exchange is the only document that still carries an identifier at
    // all (AGL-1972 stripped it from the signal). The corpus question is what
    // people asked, never who asked it.
    await record({ question: 'Anything at all.', answer: 'Something.' })
    const body = await mine()
    expect(JSON.stringify(body.prose)).not.toContain('user-7')
    expect(body.prose[0].uid).toBeUndefined()
  })
})

describe('the writer still puts the words where the reader looks', () => {
  it('stores the question and answer verbatim under the org', async () => {
    // The retention promise in `legal-documents.ts` is about THIS document.
    const id = await record({
      question: 'Does a dataset schema install create records?',
      answer: 'No — it creates an empty dataset.',
    })
    const stored = mockStore[`orgs/${ORG}/assistExchanges/${id}`]
    expect(stored).toMatchObject({
      uid: 'user-7',
      question: 'Does a dataset schema install create records?',
      answer: 'No — it creates an empty dataset.',
    })
    // …and it expires, which is what makes the 180-day promise true.
    expect(stored['expiresAt']).toBeDefined()
  })

  it('mints ONE id for both halves, which is what makes the join possible', async () => {
    const id = await record({ question: 'Q.', answer: 'A.' })
    expect(mockStore[`orgs/${ORG}/assistExchanges/${id}`]).toBeDefined()
    expect(mockStore[`orgs/${ORG}/assistSignals/${id}`]).toBeDefined()
  })
})
