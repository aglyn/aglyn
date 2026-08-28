/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * READING SOMEBODY'S MAIL, AND WHAT THE AUDIT ROW SAYS ABOUT IT.
 *
 * Firestore rules close `emailDeliveries` to everyone including staff, and
 * this route is allowed to read it only because it establishes a staff claim
 * and records who looked. The row is the compensating control, so these
 * assert the WRITTEN DOCUMENT rather than anything rendered.
 *
 * The two failure directions are opposite and both fatal:
 *
 *  * Recording one opening twice inflates the trail and makes a real second
 *    access indistinguishable from a re-run effect.
 *  * Collapsing two openings loses an access, which is the one thing this
 *    collection may never do — it would answer "nobody read your mail" about
 *    a read that happened.
 *
 * So the window is asserted from BOTH sides, and the collapse is asserted to
 * carry the repeat rather than discard it.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockMessage = jest.fn()
const mockUserByEmail = jest.fn()

/** Every `adminAudit` document, as the transaction left it. */
interface StoredRow {
  id: string
  data: Record<string, unknown>
}
let rows: StoredRow[] = []
let nextId = 0
/** Tail of the serialized transaction chain — see `runTransaction`. */
let transactionQueue: Promise<void> = Promise.resolve()

/**
 * Enough Firestore to run the real writer.
 *
 * `runTransaction` is modeled honestly for what the writer depends on: the
 * query it issues is the live `target ASC, at DESC` index's, so the double
 * resolves it by filtering on `target` and taking the newest — a stub that
 * returned an unsorted first match would let a passing test hide a writer
 * that collapses onto the wrong row.
 */
const mockFirestore = {
  collection: (name: string) => {
    const collection = {
      where: (field: string, _op: string, value: unknown) => ({
        orderBy: () => ({
          limit: () => ({
            __query: { name, field, value },
          }),
        }),
      }),
      doc: (id?: string) => ({
        id: id ?? `doc_${++nextId}`,
        __collection: name,
      }),
    }
    return collection
  },
  /*
   * SERIALIZED, because real Firestore transactions are.
   *
   * Two requests from one click race each other, and a double that ran both
   * bodies interleaved would report a failure the product does not have —
   * while a double that ran them interleaved AND passed would mean the
   * writer never asked for a transaction at all. A non-transactional
   * rewrite still fails this suite: it would reach for `get`/`add` on the
   * collection, which this double does not offer.
   */
  runTransaction: async (body: (transaction: unknown) => Promise<void>) => {
    const previous = transactionQueue
    let release = () => undefined as void
    transactionQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const transaction = {
      get: async (query: any) => {
        const matched = rows
          .filter((row) => row.data[query.__query.field] === query.__query.value)
          .sort((a, b) => Number(b.data['at']) - Number(a.data['at']))
        return {
          docs: matched.map((row) => ({
            id: row.id,
            ref: { id: row.id },
            get: (field: string) => row.data[field],
          })),
        }
      },
      update: (ref: { id: string }, patch: Record<string, unknown>) => {
        const row = rows.find((entry) => entry.id === ref.id)
        if (row) Object.assign(row.data, patch)
      },
      create: (ref: { id: string }, data: Record<string, unknown>) => {
        rows.push({ id: ref.id, data: { ...data } })
      },
    }
    try {
      await body(transaction)
    } finally {
      release()
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
  },
  findUserByEmailAcrossPools: (...args: unknown[]) => mockUserByEmail(...args),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  resendDeliveryMessageSource: () => (id: string) => mockMessage(id),
}))

/**
 * Move every stored row back in time.
 *
 * The clock is left alone deliberately. The writer stamps `new Date()` and
 * compares it against the instant on the row it found, so ageing the ROWS
 * exercises exactly the comparison the window is made of, with the real
 * clock the real code will run on — no global `Date` patch, and no fake
 * timers sitting underneath a suite whose subject is a Firestore
 * transaction.
 */
function ageStoredRows(byMs: number): void {
  for (const row of rows) {
    for (const field of ['at', 'lastAt']) {
      const value = row.data[field]
      if (value instanceof Date) {
        row.data[field] = new Date(value.getTime() - byMs)
      }
    }
  }
}

beforeEach(() => {
  jest.resetModules()
  rows = []
  nextId = 0
  transactionQueue = Promise.resolve()
  process.env['RESEND_READ_API_KEY'] = 're_full_access'
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff_1',
    email_verified: true,
    staff: true,
  })
  mockMessage.mockResolvedValue({
    provider: 'resend',
    providerMessageId: 'msg_1',
    to: ['casey@customer.example'],
    cc: [],
    bcc: [],
    from: 'hello@aglyn.com',
    replyTo: null,
    subject: 'Reset your password',
    html: '<p>hi</p>',
    text: 'hi',
    sentAt: 1_755_900_000_000,
    status: 'delivered',
  })
  mockUserByEmail.mockResolvedValue({
    record: { uid: 'customer_uid_1' },
    tenantId: null,
  })
})

async function viewMessage(id = 'msg_1'): Promise<Response> {
  const { GET } = await import('../app/api/admin/emails/message/route')
  return GET(
    new Request(`https://app.aglyn.com/api/admin/emails/message?id=${id}`, {
      headers: { authorization: 'Bearer token' },
    }),
  )
}

const auditRows = () => rows.map((row) => row.data)

describe('one opening writes one row', () => {
  it('records a single access when the view is fetched twice at once', async () => {
    // The shape a re-run effect produces: two requests, one click. Issued
    // together rather than in sequence, because the collapse this asserts is
    // the one that has to survive a race.
    const [first, second] = await Promise.all([viewMessage(), viewMessage()])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(auditRows()).toHaveLength(1)
    // The repeat is RECORDED, not discarded. A row that stood silently for
    // two accesses would be the same omission as a missing row.
    expect(auditRows()[0]).toMatchObject({
      actorUid: 'staff_1',
      action: 'email.message-viewed',
      target: 'emailDeliveries/msg_1',
      repeatCount: 2,
    })
  })

  it('records two rows for two genuinely separate openings', async () => {
    await viewMessage()
    // CONTROL, and the assertion that keeps the collapse honest: past the
    // window a second look is a second decision by a person, and an audit
    // log that merged them could not answer how often somebody looked. The
    // observed genuine re-open was fifty-three seconds after the first.
    ageStoredRows(53_000)
    await viewMessage()

    expect(auditRows()).toHaveLength(2)
    expect(auditRows().map((row) => row['repeatCount'])).toEqual([1, 1])
  })

  it('keeps a different actor on the same message separate', async () => {
    await viewMessage()
    // CONTROL on the actor half of the key. Two staff members opening the
    // same message inside ten seconds is two people having read it, and
    // collapsing those would erase one of them from the trail entirely.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff_2',
      email_verified: true,
      staff: true,
    })
    await viewMessage()

    expect(auditRows()).toHaveLength(2)
    expect(auditRows().map((row) => row['actorUid'])).toEqual([
      'staff_1',
      'staff_2',
    ])
  })
})

describe('the row names the person it is about', () => {
  it('carries the recipient uid as the subject', async () => {
    await viewMessage()
    // The whole point of item 2: `target` is a message id and can never
    // match `users/{uid}`, so without this the access is invisible on the
    // page of the person whose mail was read.
    expect(auditRows()[0]).toMatchObject({ subjectUid: 'customer_uid_1' })
    expect(mockUserByEmail).toHaveBeenCalledWith('casey@customer.example')
  })

  it('leaves the subject absent when the recipient has no account', async () => {
    // CONTROL. Most of our outbound mail goes to site members, prospects and
    // plain contacts. An absent subject is the correct answer for them, and
    // inventing one would file a staff access under an innocent person.
    mockUserByEmail.mockResolvedValue(null)
    await viewMessage()

    expect(auditRows()[0]).not.toHaveProperty('subjectUid')
  })

  it('does not store the recipient address in the clear', async () => {
    await viewMessage()

    const note = String(auditRows()[0]['note'])
    // `emailDeliveries` is keyed by `sha256(address)` so we do not hold a
    // readable list of who we mail. A row echoing the address made the audit
    // log — readable by any staff role — the leakier of the two.
    expect(note).not.toContain('casey@customer.example')
    expect(note).toBe('c***@customer.example')
  })
})
