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
 * AGL-2316 — the READ half of the clickwrap record.
 *
 * `legal-acceptance.spec.ts` beside this one proves the write. It passed for
 * months while the whole feature was dead, which is the shape of defect this
 * file exists for: a row that exists and nothing that asks it a question.
 *
 * So nothing here asserts "a document was read". Each test asserts an ANSWER
 * that a dispute or a Terms change actually needs:
 *
 *   - which version is on file, and whether the CURRENT one is;
 *   - whether ToS §18.5's 30-day arbitration opt-out window is still open —
 *     checked AT the boundary instant and one millisecond either side of it,
 *     because a window is only ever wrong at its edges;
 *   - that re-acceptance FIRES when the published version moves past what was
 *     accepted, and does NOT fire when it has not. Both halves: a predicate
 *     hard-wired to `true` satisfies the first alone.
 */

import {
  ARBITRATION_OPT_OUT_DAYS,
  compareLegalDocumentVersions,
  evaluateLegalAcceptance,
  getLegalAcceptanceStatus,
  parseLegalDocumentVersion,
  readLegalAcceptances,
  recordLegalAcceptance,
  type StoredLegalAcceptance,
} from './legal-acceptance'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }) },
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))

const DOCUMENTS = [
  {
    key: 'terms',
    url: 'https://aglyn.com/legal/terms',
    sha256: 'a'.repeat(64),
    bytes: 35966,
  },
]

function acceptance(
  version: string,
  acceptedAt: string | null,
  extra: Partial<StoredLegalAcceptance> = {},
): StoredLegalAcceptance {
  return {
    version,
    acceptedAt,
    context: 'signup-password',
    method: 'clickwrap',
    ipAddress: '203.0.113.7',
    userAgent: 'jest',
    documents: DOCUMENTS,
    ...extra,
  }
}

/**
 * A Firestore double for the subcollection read. Models `docs[].get(field)`
 * and `doc.id` because the reader depends on BOTH — the id is the version, and
 * is the fallback when the field never landed.
 */
function fakeFirestore(
  records: Array<{ id: string; data: Record<string, unknown> }>,
) {
  const calls: string[] = []
  return {
    calls,
    collection: (name: string) => ({
      doc: (id: string) => ({
        collection: (sub: string) => ({
          get: async () => {
            calls.push(`${name}/${id}/${sub}`)
            return {
              docs: records.map((record) => ({
                id: record.id,
                get: (field: string) => record.data[field],
              })),
            }
          },
        }),
      }),
    }),
  }
}

describe('AGL-2316 · version ordering', () => {
  it('ranks the published `v<N>` scheme numerically, not as text', () => {
    // The whole point: `'v10' < 'v9'` lexicographically, and a string compare
    // here would stop asking for re-acceptance forever at the tenth publish.
    expect(compareLegalDocumentVersions('v10', 'v9')).toBeGreaterThan(0)
    expect(compareLegalDocumentVersions('v6', 'v6')).toBe(0)
    expect(compareLegalDocumentVersions('v5', 'v6')).toBeLessThan(0)
    expect(parseLegalDocumentVersion('v6')).toBe(6)
    expect(parseLegalDocumentVersion('2026-08-18')).toBeNull()
  })

  it('sorts an unrecognised id OLDER, so it can never suppress a prompt', () => {
    expect(compareLegalDocumentVersions('v1', 'legacy')).toBeGreaterThan(0)
    expect(compareLegalDocumentVersions('legacy', 'v1')).toBeLessThan(0)
  })
})

describe('AGL-2316 · did this person accept, and which version', () => {
  it('answers with the version and the server timestamp on the record', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v6', '2026-08-18T12:00:00.000Z')],
      currentVersion: 'v6',
      now: new Date('2026-08-19T00:00:00.000Z'),
    })
    expect(status.accepted).toBe(true)
    expect(status.currentVersionAcceptedAt).toBe('2026-08-18T12:00:00.000Z')
    expect(status.latestAcceptedVersion).toBe('v6')
    // The history travels with the answer — a dispute asks what was SHOWN.
    expect(status.acceptances[0].documents[0].sha256).toBe('a'.repeat(64))
  })

  it('reports the history oldest-first, however it came back from the store', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v6', '2026-08-18T12:00:00.000Z'),
        acceptance('v1', '2026-08-10T12:00:00.000Z'),
        acceptance('v4', '2026-08-14T12:00:00.000Z'),
      ],
      currentVersion: 'v6',
    })
    expect(status.acceptedVersions).toEqual(['v1', 'v4', 'v6'])
  })

  it('says no acceptance rather than pretending one', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [],
      currentVersion: 'v6',
    })
    expect(status.accepted).toBe(false)
    expect(status.latestAcceptedVersion).toBeNull()
    // Not `false`. "We hold nothing" and "the window closed" are different
    // answers, and a surface must be able to tell them apart.
    expect(status.arbitration.open).toBeNull()
    expect(status.arbitration.firstAcceptedAt).toBeNull()
  })
})

describe('AGL-2316 · the §18.5 opt-out window, AT the boundary', () => {
  const FIRST = '2026-08-01T00:00:00.000Z'
  // 30 days after FIRST, to the millisecond.
  const DEADLINE = '2026-08-31T00:00:00.000Z'
  const history = [acceptance('v6', FIRST)]

  it('pins the window to the thirty days the published Terms state', () => {
    expect(ARBITRATION_OPT_OUT_DAYS).toBe(30)
    const status = evaluateLegalAcceptance({
      acceptances: history,
      currentVersion: 'v6',
      now: new Date(FIRST),
    })
    expect(status.arbitration.deadline).toBe(DEADLINE)
  })

  it('is still OPEN at the deadline instant itself', () => {
    // "within 30 days of first accepting" includes the thirtieth day. A `<`
    // comparison closes it a day early and nobody notices until someone is
    // told they missed a deadline they did not miss.
    const status = evaluateLegalAcceptance({
      acceptances: history,
      currentVersion: 'v6',
      now: new Date(DEADLINE),
    })
    expect(status.arbitration.open).toBe(true)
    expect(status.arbitration.daysRemaining).toBe(0)
  })

  it('is CLOSED one millisecond after it', () => {
    const status = evaluateLegalAcceptance({
      acceptances: history,
      currentVersion: 'v6',
      now: new Date(new Date(DEADLINE).getTime() + 1),
    })
    expect(status.arbitration.open).toBe(false)
    expect(status.arbitration.daysRemaining).toBe(0)
  })

  it('has one day left one millisecond before it', () => {
    const status = evaluateLegalAcceptance({
      acceptances: history,
      currentVersion: 'v6',
      now: new Date(new Date(DEADLINE).getTime() - 1),
    })
    expect(status.arbitration.open).toBe(true)
    expect(status.arbitration.daysRemaining).toBe(1)
  })

  it('runs from FIRST accepting, so a re-acceptance cannot restart it', () => {
    // The clause says "first accepting these Terms". Measuring from the newest
    // record would hand a returning customer a right the document does not
    // give — and this is the one timestamp the writer refuses to overwrite.
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v1', FIRST),
        acceptance('v6', '2026-09-15T00:00:00.000Z'),
      ],
      currentVersion: 'v6',
      now: new Date('2026-09-16T00:00:00.000Z'),
    })
    expect(status.arbitration.firstAcceptedAt).toBe(FIRST)
    expect(status.arbitration.open).toBe(false)
  })

  it('measures from the earliest TIMESTAMP even when versions arrived out of order', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v6', '2026-08-05T00:00:00.000Z'),
        // A backfilled older version written later: rank says v1 is first,
        // the clock says otherwise, and §18.5 is a clock.
        acceptance('v1', '2026-08-20T00:00:00.000Z'),
      ],
      currentVersion: 'v6',
      now: new Date('2026-08-06T00:00:00.000Z'),
    })
    expect(status.arbitration.firstAcceptedAt).toBe('2026-08-05T00:00:00.000Z')
  })
})

describe('AGL-2316 · re-acceptance fires, and does not fire', () => {
  it('FIRES when the published version moved past what was accepted', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v5', '2026-08-18T00:00:00.000Z')],
      currentVersion: 'v6',
    })
    expect(status.reacceptanceRequired).toBe(true)
    expect(status.reacceptanceReason).toBe('version-superseded')
    expect(status.accepted).toBe(false)
  })

  it('DOES NOT fire when the current version is already on file', () => {
    // The other half. A predicate returning a constant `true` passes the test
    // above and fails this one, which is the only reason that one means
    // anything.
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v5', '2026-08-18T00:00:00.000Z'),
        acceptance('v6', '2026-08-19T00:00:00.000Z'),
      ],
      currentVersion: 'v6',
    })
    expect(status.reacceptanceRequired).toBe(false)
    expect(status.reacceptanceReason).toBe('none')
  })

  it('DOES NOT fire when the deploy is BEHIND the accepted version', () => {
    // A rollback, or a stale instance mid-deploy. Asking someone to re-accept
    // terms older than the ones they already agreed to is worse than silence.
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v6', '2026-08-19T00:00:00.000Z')],
      currentVersion: 'v5',
    })
    expect(status.reacceptanceRequired).toBe(false)
  })

  it('distinguishes "never accepted" from "accepted something older"', () => {
    const never = evaluateLegalAcceptance({
      acceptances: [],
      currentVersion: 'v6',
    })
    expect(never.reacceptanceRequired).toBe(true)
    expect(never.reacceptanceReason).toBe('never-accepted')
  })
})

/**
 * The two facts the banner needs to acknowledge an existing acceptance rather
 * than read like a first-time ask (don't phrase it that
 * they havent agreed before it creates confusion and frustration.
 *
 * WHEN they last agreed, and WHAT moved since. Both are derived from records
 * that already exist — no changelog mechanism is invented, and where the
 * derivation cannot be made the answer is UNKNOWN rather than a confident
 * "nothing changed".
 */
describe('AGL-2316 · when they last agreed, and what moved since', () => {
  const PRIVACY = {
    key: 'privacy',
    url: 'https://aglyn.com/legal/privacy',
    sha256: 'b'.repeat(64),
    bytes: 15286,
  }

  it('reports the timestamp of the LATEST acceptance, not the current one', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v4', '2026-08-14T00:00:00.000Z'),
        acceptance('v5', '2026-08-23T14:05:00.000Z'),
      ],
      currentVersion: 'v6',
    })
    expect(status.latestAcceptedAt).toBe('2026-08-23T14:05:00.000Z')
    // The field that already existed cannot answer this: it is null in
    // exactly the case the banner renders in.
    expect(status.currentVersionAcceptedAt).toBeNull()
  })

  it('reports NULL when the record carries no timestamp', () => {
    // Documented as "null only if the write was partial" — and
    // `strictNullChecks` is off, so a surface that does not branch on this
    // renders the epoch or the word "undefined" to a customer.
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v5', null)],
      currentVersion: 'v6',
    })
    expect(status.latestAcceptedAt).toBeNull()
  })

  it('names only the documents whose text actually MOVED', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v5', '2026-08-18T00:00:00.000Z', {
          documents: [...DOCUMENTS, PRIVACY],
        }),
      ],
      currentVersion: 'v6',
      currentDocuments: [
        // terms re-pinned, privacy untouched.
        { ...DOCUMENTS[0], sha256: 'c'.repeat(64) },
        PRIVACY,
      ],
    })
    expect(status.changedDocumentKeys).toEqual(['terms'])
  })

  it('counts a document the old record never carried as a change', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v5', '2026-08-18T00:00:00.000Z')],
      currentVersion: 'v6',
      currentDocuments: [...DOCUMENTS, PRIVACY],
    })
    expect(status.changedDocumentKeys).toEqual(['privacy'])
  })

  it('answers UNKNOWN — not "nothing changed" — when a hash is missing', () => {
    // One unknowable key makes the whole list unknowable: a partial list
    // reads as a complete one, which is the assertion this must not make.
    const status = evaluateLegalAcceptance({
      acceptances: [
        acceptance('v5', '2026-08-18T00:00:00.000Z', {
          documents: [{ key: 'terms', url: 'https://aglyn.com/legal/terms' }],
        }),
      ],
      currentVersion: 'v6',
      currentDocuments: DOCUMENTS,
    })
    expect(status.changedDocumentKeys).toBeNull()
  })

  it('answers UNKNOWN when no current manifest was supplied', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [acceptance('v5', '2026-08-18T00:00:00.000Z')],
      currentVersion: 'v6',
    })
    expect(status.changedDocumentKeys).toBeNull()
  })

  it('answers UNKNOWN when there is nothing accepted to compare against', () => {
    const status = evaluateLegalAcceptance({
      acceptances: [],
      currentVersion: 'v6',
      currentDocuments: DOCUMENTS,
    })
    expect(status.latestAcceptedAt).toBeNull()
    expect(status.changedDocumentKeys).toBeNull()
  })
})

describe('AGL-2316 · reading the stored records', () => {
  it('projects the fields a dispute is answered from, and the doc id as version', async () => {
    const firestore = fakeFirestore([
      {
        id: 'v6',
        data: {
          version: 'v6',
          context: 'signup-google',
          method: 'clickwrap',
          ipAddress: '198.51.100.4',
          userAgent: 'Mozilla/5.0',
          documents: DOCUMENTS,
          acceptedAt: { toDate: () => new Date('2026-08-18T12:00:00.000Z') },
        },
      },
    ])
    const records = await readLegalAcceptances('uid-1', { firestore } as any)
    expect(firestore.calls).toEqual(['users/uid-1/legalAcceptances'])
    expect(records).toEqual([
      {
        version: 'v6',
        acceptedAt: '2026-08-18T12:00:00.000Z',
        context: 'signup-google',
        method: 'clickwrap',
        ipAddress: '198.51.100.4',
        userAgent: 'Mozilla/5.0',
        documents: DOCUMENTS,
      },
    ])
  })

  it('falls back to the document id when the version field never landed', async () => {
    const firestore = fakeFirestore([{ id: 'v4', data: { method: 'clickwrap' } }])
    const [record] = await readLegalAcceptances('uid-1', { firestore } as any)
    expect(record.version).toBe('v4')
    expect(record.acceptedAt).toBeNull()
  })

  it('reads and evaluates in one call, against the version it is given', async () => {
    const firestore = fakeFirestore([
      {
        id: 'v5',
        data: {
          version: 'v5',
          acceptedAt: { toDate: () => new Date('2026-08-18T00:00:00.000Z') },
        },
      },
    ])
    const status = await getLegalAcceptanceStatus('uid-1', {
      currentVersion: 'v6',
      firestore,
      now: new Date('2026-08-19T00:00:00.000Z'),
    } as any)
    expect(status.reacceptanceRequired).toBe(true)
    expect(status.arbitration.open).toBe(true)
  })

  it('refuses a read with no uid rather than reading someone else', async () => {
    await expect(readLegalAcceptances('', {} as any)).rejects.toThrow(
      'uid is required',
    )
  })
})

/**
 * A store that both WRITES and READS, so the two halves can be run against
 * each other. Everything above this point tests one side at a time, and one
 * side at a time is exactly how this feature stayed broken: the write spec
 * was green for months.
 *
 * `acceptedAt` is materialised on write, because the real server sentinel
 * resolves to a time and the reader's whole job is to hand that time to a
 * dispute.
 */
function readWriteFirestore() {
  const docs: Record<string, Record<string, unknown>> = {}
  const writeTime = new Date('2026-08-19T09:00:00.000Z')
  return {
    docs,
    collection: (name: string) => ({
      doc: (id: string) => ({
        collection: (sub: string) => ({
          get: async () => ({
            docs: Object.entries(docs)
              .filter(([path]) => path.startsWith(`${name}/${id}/${sub}/`))
              .map(([path, data]) => ({
                id: path.split('/').pop(),
                get: (field: string) => data[field],
              })),
          }),
          doc: (versionId: string) => {
            const path = `${name}/${id}/${sub}/${versionId}`
            return {
              get: async () => ({ exists: docs[path] !== undefined }),
              set: async (data: Record<string, unknown>) => {
                docs[path] = { ...data, acceptedAt: { toDate: () => writeTime } }
              },
            }
          },
        }),
      }),
    }),
  }
}

describe('AGL-2316 · the write and the read, against each other', () => {
  it('records the version it was GIVEN, and the reader then finds it accepted', async () => {
    // THE MUTATION THIS EXISTS FOR: a writer that stamps a literal instead of
    // the version it was handed. Every write-side assertion in
    // `legal-acceptance.spec.ts` uses `v1` as its fixture, so hard-coding
    // `'v1'` passes all of them — and produces a store in which the current
    // version is never on file and every customer is asked to re-accept
    // forever. Only a round trip against a DIFFERENT current version catches
    // it.
    const firestore = readWriteFirestore()
    await recordLegalAcceptance('uid-1', {
      version: 'v6',
      documents: DOCUMENTS,
      context: 'reaccept-console',
      firestore,
    })

    const status = await getLegalAcceptanceStatus('uid-1', {
      currentVersion: 'v6',
      firestore,
      now: new Date('2026-08-20T09:00:00.000Z'),
    } as any)

    expect(status.accepted).toBe(true)
    expect(status.acceptedVersions).toEqual(['v6'])
    expect(status.reacceptanceRequired).toBe(false)
    expect(status.currentVersionAcceptedAt).toBe('2026-08-19T09:00:00.000Z')
    expect(status.acceptances[0].context).toBe('reaccept-console')
  })

  it('a re-acceptance ADDS a version and leaves the §18.5 clock where it was', async () => {
    const firestore = readWriteFirestore()
    await recordLegalAcceptance('uid-1', {
      version: 'v5',
      documents: DOCUMENTS,
      context: 'signup-password',
      firestore,
    })
    const before = await getLegalAcceptanceStatus('uid-1', {
      currentVersion: 'v6',
      firestore,
      now: new Date('2026-08-20T09:00:00.000Z'),
    } as any)
    expect(before.reacceptanceRequired).toBe(true)

    await recordLegalAcceptance('uid-1', {
      version: 'v6',
      documents: DOCUMENTS,
      context: 'reaccept-console',
      firestore,
    })
    const after = await getLegalAcceptanceStatus('uid-1', {
      currentVersion: 'v6',
      firestore,
      now: new Date('2026-08-20T09:00:00.000Z'),
    } as any)

    // Additive: the older acceptance is still evidence of what was agreed.
    expect(after.acceptedVersions).toEqual(['v5', 'v6'])
    expect(after.reacceptanceRequired).toBe(false)
    // And the opt-out window did NOT restart — same first acceptance.
    expect(after.arbitration.firstAcceptedAt).toBe(
      before.arbitration.firstAcceptedAt,
    )
  })
})
