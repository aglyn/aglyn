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
 * TAKING SOMETHING AWAY, WITHOUT TAKING DELIVERED MAIL WITH IT.
 *
 * Two removals, and every assertion here is about what SURVIVES one.
 *
 *  1. Deleting a campaign removes the container and nothing else. Its emails
 *     keep their ids, their reports and their unsubscribe links, and they
 *     read afterwards as the single sends the product already models.
 *  2. Discarding removes a draft — an email nobody has ever received — and
 *     refuses every other state, including inside the transaction that
 *     deletes, because the state a console showed a moment ago is a snapshot.
 *
 * ## Why the unsubscribe link is proved here and not taken on trust
 *
 * Every unsubscribe footer already delivered carries `cid={sendId}` INSIDE
 * its own HMAC, and those messages sit in inboxes forever. So "the sends
 * survive" is not a tidiness argument: a send id that stops resolving is an
 * opt-out that stops working. The link is therefore minted before the delete
 * and verified after it, against the real signer and the real verifier rather
 * than a restatement of them — and the surviving document is the one the
 * unsubscribe handler increments, so its existence is asserted too.
 */

const store = new Map<string, Record<string, any>>()

/** The `FieldValue.delete()` sentinel, resolved by the double below. */
function deleteSentinel() {
  return { __delete: true }
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `update()`, with the delete sentinel resolved rather than stored. */
function applyUpdate(
  existing: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && '__delete' in value) delete next[key]
    else next[key] = value
  }
  return next
}

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    exists: data !== undefined,
    id: path.split('/').pop() as string,
    ref: docRef(path),
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get firestore() {
      return mockFirestore()
    },
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>) => {
      store.set(path, { ...(store.get(path) ?? {}), ...value })
    },
    update: async (value: Record<string, any>) => {
      if (!store.has(path)) throw new Error(`no document at ${path}`)
      store.set(path, applyUpdate(store.get(path) ?? {}, value))
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

/** The ids directly under `path`. */
function childIds(path: string): string[] {
  return [...store.keys()]
    .filter(
      (key) =>
        key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    .map((key) => key.slice(path.length + 1))
    .sort()
}

/**
 * Equality + `limit`, which is the only query shape the detach makes.
 *
 * The double answers from the CURRENT store on every `get`, which is what
 * makes the detach loop terminate here for the same reason it terminates
 * against Firestore: each pass clears the very field it matched on, so a send
 * already detached is not returned again. A double that snapshotted the
 * collection once would loop forever on a campaign larger than one batch, and
 * a double that always answered empty would let a broken detach pass.
 */
function collectionRef(path: string): any {
  const filtered = (
    field: string | null,
    value: unknown,
    cap: number,
  ): any => ({
    limit: (max: number) => filtered(field, value, max),
    where: (nextField: string, _op: string, nextValue: unknown) =>
      filtered(nextField, nextValue, cap),
    get: async () => {
      const docs = childIds(path)
        .map((id) => snapshotOf(`${path}/${id}`))
        .filter((doc) => (field ? doc.get(field) === value : true))
        .slice(0, cap)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  })
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    ...filtered(null, undefined, Infinity),
  }
}

/** How many batch commits the run made, so a ceiling can be asserted. */
const commits: number[] = []

function mockFirestore(): any {
  return {
    collection: (name: string) => collectionRef(name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        update: (ref: any, value: Record<string, any>) => {
          writes.push(() => {
            store.set(ref.path, applyUpdate(store.get(ref.path) ?? {}, value))
          })
        },
        delete: (ref: any) => {
          writes.push(() => store.delete(ref.path))
        },
        commit: async () => {
          commits.push(writes.length)
          for (const write of writes) write()
        },
      }
    },
    /*
     * The transaction runs its body against the live store and applies its
     * writes at the end, which is enough for what is under test: the discard
     * re-reads the record's state INSIDE it, and a double that read from a
     * snapshot taken before the body ran could not tell a check made inside
     * from one made outside.
     */
    runTransaction: async (body: (transaction: any) => Promise<any>) => {
      const writes: Array<() => void> = []
      const transaction = {
        get: async (ref: any) => snapshotOf(ref.path),
        update: (ref: any, value: Record<string, any>) => {
          writes.push(() => {
            store.set(ref.path, applyUpdate(store.get(ref.path) ?? {}, value))
          })
        },
        delete: (ref: any) => {
          writes.push(() => store.delete(ref.path))
        },
      }
      const outcome = await body(transaction)
      for (const write of writes) write()
      return outcome
    },
  }
}

let mockUid = 'uid-1'

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => mockFirestore(),
      auth: () => ({ verifyIdToken: async () => ({ uid: mockUid }) }),
    }),
    firestore: { FieldValue: { delete: deleteSentinel } },
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import {
  campaignListRows,
  CAMPAIGN_SEND_CONTAINER_FIELD,
} from '@aglyn/plugins-email/model'
import {
  buildUnsubscribeUrl,
  unsubscribeSignatureMatches,
} from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { campaignManageHandler } from './campaign-manage'

const HOST = 'host-1'
const CAMPAIGN = 'spring-2026'
const SECRET = 'test-secret'

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  return { res, result }
}

async function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer token' },
) {
  const { res, result } = makeResponse()
  await campaignManageHandler(
    { method: 'POST', query: {}, body, cookies: {}, headers } as any,
    res,
  )
  return result
}

/** One send inside the campaign, as the send path writes one. */
function seedSend(id: string, over: Record<string, any> = {}) {
  store.set(`hosts/${HOST}/campaigns/${id}`, {
    subject: `Subject ${id}`,
    status: 'sent',
    audience: 'leads',
    topicId: 'marketing',
    createdAtMs: Date.UTC(2026, 2, 1),
    sentAt: { seconds: 1_760_000_000 },
    stats: { sent: 10, recipients: 10, delivered: 9, opens: 4, clicks: 1 },
    [CAMPAIGN_SEND_CONTAINER_FIELD]: CAMPAIGN,
    ...over,
  })
}

const stored = (path: string) => store.get(`hosts/${HOST}/${path}`)

beforeEach(() => {
  store.clear()
  commits.length = 0
  mockUid = 'uid-1'
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = SECRET
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { 'uid-1': 'admin', 'uid-viewer': 'viewer' },
  })
  store.set(`hosts/${HOST}/emailCampaigns/${CAMPAIGN}`, {
    name: 'Spring sale',
    startAtMs: Date.UTC(2026, 2, 1),
    listIds: ['list-1'],
  })
})

describe('who may take something away', () => {
  it('refuses a caller with no token', async () => {
    const result = await post(
      { hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN },
      {},
    )
    expect(result.status).toBe(401)
    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeTruthy()
  })

  it('refuses a member who is neither admin nor editor', async () => {
    mockUid = 'uid-viewer'
    const result = await post({
      hostId: HOST,
      action: 'deleteCampaign',
      campaignId: CAMPAIGN,
    })
    expect(result.status).toBe(403)
    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeTruthy()
  })

  it('refuses an action it does not recognize, rather than guessing', async () => {
    const result = await post({
      hostId: HOST,
      action: 'purge',
      campaignId: CAMPAIGN,
    })
    expect(result.status).toBe(400)
    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeTruthy()
  })

  it('refuses a campaign id that is a PATH', async () => {
    // `a/b/c` would address a document under a collection nobody can see, the
    // same shape AGL-1771 found on the schedule branch.
    const result = await post({
      hostId: HOST,
      action: 'deleteCampaign',
      campaignId: 'a/b/c',
    })
    expect(result.status).toBe(400)
  })
})

describe('deleting a campaign', () => {
  it('removes the container and DETACHES its emails', async () => {
    seedSend('send-1')
    seedSend('send-2')

    const result = await post({
      hostId: HOST,
      action: 'deleteCampaign',
      campaignId: CAMPAIGN,
    })

    expect(result.status).toBe(200)
    expect(result.body.detached).toBe(2)
    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeUndefined()
    // The sends are STILL THERE, at the ids they have always had.
    expect(stored('campaigns/send-1')).toBeTruthy()
    expect(stored('campaigns/send-2')).toBeTruthy()
  })

  it('leaves everything on a surviving send except the container id', async () => {
    seedSend('send-1')
    const before = { ...(stored('campaigns/send-1') as Record<string, any>) }

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    const after = stored('campaigns/send-1') as Record<string, any>
    expect(after.subject).toBe(before.subject)
    expect(after.stats).toEqual(before.stats)
    expect(after.sentAt).toEqual(before.sentAt)
    expect(after.topicId).toBe(before.topicId)
    expect(after.createdAtMs).toBe(before.createdAtMs)
    // The one field that goes, and it is REMOVED rather than emptied: the
    // detail page's `where` clause matches absence, not `''`.
    expect(CAMPAIGN_SEND_CONTAINER_FIELD in after).toBe(false)
  })

  /*
   * THE POINT OF THE WHOLE THING. A send that named a container which no
   * longer exists is in neither half of `campaignListRows` — not a container
   * row, and not an orphan the list adopts — so it would vanish from the
   * campaigns table while remaining perfectly deliverable.
   */
  it('leaves each send reading as a SINGLE SEND in the campaigns list', async () => {
    seedSend('send-1')
    seedSend('send-2')

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    const sends = ['send-1', 'send-2'].map((id) => ({
      $id: id,
      ...(stored(`campaigns/${id}`) as Record<string, any>),
    }))
    const rows = campaignListRows([], sends, Date.now())
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.legacy)).toBe(true)
    expect(rows.map((row) => row.id).sort()).toEqual(['send-1', 'send-2'])
    // And each still reports its own figures, which is its report intact.
    expect(rows[0].rollup.sent.value).toBe(10)
  })

  /*==========================================
   * THE UNSUBSCRIBE LINKS, MINTED BEFORE AND VERIFIED AFTER.
   *
   * `cid={sendId}` is inside the signature of every footer already
   * delivered. This is the assertion that says deleting a campaign is not a
   * compliance failure.
   *=========================================*/
  it('leaves every cid= unsubscribe link verifying, and its send addressable', async () => {
    seedSend('send-1')
    const url = buildUnsubscribeUrl({
      siteBase: 'https://acme.example',
      hostId: HOST,
      email: 'ada@example.com',
      campaignId: 'send-1',
      secret: SECRET,
    })
    expect(url).toContain('cid=send-1')
    const signature = new URL(url).searchParams.get('sig') as string

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    expect(
      unsubscribeSignatureMatches({
        hostId: HOST,
        email: 'ada@example.com',
        campaignId: 'send-1',
        signature,
        secret: SECRET,
      }),
    ).toBe(true)
    /*
     * The handler does not merely verify — it increments
     * `stats.unsubscribes` on the send by id, with `update()`, which REFUSES
     * a missing document precisely so an opt-out never creates a phantom
     * campaign. So this write succeeding is the proof the id still resolves.
     */
    await docRef(`hosts/${HOST}/campaigns/send-1`).update({
      'stats.unsubscribes': 1,
    })
    expect(stored('campaigns/send-1')?.['stats.unsubscribes']).toBe(1)
  })

  it('does not touch a send belonging to a DIFFERENT campaign', async () => {
    seedSend('send-1')
    seedSend('other-send', { [CAMPAIGN_SEND_CONTAINER_FIELD]: 'autumn-2026' })

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    expect(
      stored('campaigns/other-send')?.[CAMPAIGN_SEND_CONTAINER_FIELD],
    ).toBe('autumn-2026')
  })

  it('does NOT cancel a scheduled email inside it', async () => {
    // Deleting a campaign groups nothing; it does not stop mail. The console
    // says so before it asks, and this is the behavior it is describing.
    seedSend('due-friday', {
      status: 'scheduled',
      sendAtMs: Date.UTC(2026, 5, 5),
      sentAt: null,
    })

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    const survivor = stored('campaigns/due-friday') as Record<string, any>
    expect(survivor.status).toBe('scheduled')
    expect(survivor.sendAtMs).toBe(Date.UTC(2026, 5, 5))
  })

  it('detaches a campaign larger than one batch', async () => {
    // The loop clears the field it queries on, so each pass returns the next
    // slice. 401 sends is one full batch plus a remainder.
    for (let index = 0; index < 401; index += 1) {
      seedSend(`send-${String(index).padStart(4, '0')}`)
    }

    const result = await post({
      hostId: HOST,
      action: 'deleteCampaign',
      campaignId: CAMPAIGN,
    })

    expect(result.status).toBe(200)
    expect(result.body.detached).toBe(401)
    expect(commits).toEqual([400, 1])
    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeUndefined()
    expect(
      [...store.keys()].filter((key) =>
        store.get(key)?.[CAMPAIGN_SEND_CONTAINER_FIELD],
      ),
    ).toHaveLength(0)
  })

  /*==========================================
   * A CAMPAIGN THAT IS STILL DELIVERING.
   *
   * An audience larger than one batch goes out over several runs, and between
   * them the email is stored as `scheduled` with a `resume` map that the
   * scheduled processor picks up on its next beat.
   *
   * Deleting the container does NOT stop it, and that is the answer rather
   * than an oversight. The container is a grouping; the mail is the send, and
   * the processor finds a send by its own status and due time and never reads
   * a container at all. Stopping somebody's mail is `cancel`, on that email's
   * own page — a separate act with a separate consequence, since what has
   * already gone out cannot be recalled. The console says so before it asks.
   *
   * What the delete must not do is leave the send un-resumable or invisible,
   * and both are asserted below.
   *=========================================*/
  it('leaves a partly-sent email exactly as resumable as it was', async () => {
    seedSend('half-way', {
      status: 'scheduled',
      sentAt: null,
      sendAtMs: 1_800_000_000_000,
      stats: { sent: 500, delivered: 480, audienceSize: 3000 },
      resume: { remaining: 2500, batch: 1, nextAtMs: 1_800_000_000_000 },
    })

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    const survivor = stored('campaigns/half-way') as Record<string, any>
    // Everything the processor's claim reads: the status it queries on, the
    // time it is due, and the batch record that tells it this is a
    // continuation rather than a first send.
    expect(survivor.status).toBe('scheduled')
    expect(survivor.sendAtMs).toBe(1_800_000_000_000)
    expect(survivor.resume).toEqual({
      remaining: 2500,
      batch: 1,
      nextAtMs: 1_800_000_000_000,
    })
    // And the 500 it has already delivered are still on the record.
    expect(survivor.stats.sent).toBe(500)
  })

  it('leaves a partly-sent email VISIBLE, as a single send in progress', async () => {
    /*
     * The failure this guards is the quiet one: a send that named a container
     * which no longer exists is in neither half of `campaignListRows`, so it
     * would go on delivering thousands of messages while showing nowhere in
     * the console — which is the one state in which a merchant cannot stop it.
     */
    seedSend('half-way', {
      status: 'scheduled',
      sentAt: null,
      sendAtMs: 1_800_000_000_000,
      stats: { sent: 500, delivered: 480, audienceSize: 3000 },
      resume: { remaining: 2500, batch: 1, nextAtMs: 1_800_000_000_000 },
    })

    await post({ hostId: HOST, action: 'deleteCampaign', campaignId: CAMPAIGN })

    const rows = campaignListRows(
      [],
      [
        {
          $id: 'half-way',
          ...((stored('campaigns/half-way') ?? {}) as Record<string, unknown>),
        },
      ],
      Date.now(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].legacy).toBe(true)
    // Counted as a send in progress rather than as one that has not started.
    expect(rows[0].rollup.sending).toBe(1)
    expect(rows[0].rollup.sent.value).toBe(500)
  })

  it('answers 404 for an id that names no container', async () => {
    /*
     * Very often that id names a SEND — the campaign URL resolves both, which
     * is what keeps every link minted before containers existed working — so
     * answering it as a completed deletion would tell the console it had
     * removed something it never touched.
     */
    const result = await post({
      hostId: HOST,
      action: 'deleteCampaign',
      campaignId: 'not-a-campaign',
    })
    expect(result.status).toBe(404)
  })
})

describe('discarding a draft', () => {
  const seedDraft = (id: string, over: Record<string, any> = {}) =>
    store.set(`hosts/${HOST}/campaigns/${id}`, {
      status: 'draft',
      displayName: 'Half-written',
      createdAtMs: Date.UTC(2026, 7, 20),
      ...over,
    })

  it('removes a draft', async () => {
    seedDraft('draft-1')
    const result = await post({
      hostId: HOST,
      action: 'discardEmail',
      campaignId: 'draft-1',
    })
    expect(result.status).toBe(200)
    expect(stored('campaigns/draft-1')).toBeUndefined()
  })

  /*==========================================
   * AND ONLY A DRAFT.
   *
   * Each refusal names what to do instead, because "you cannot" leaves a
   * merchant with an email they wanted rid of and no next step — and for a
   * scheduled one the next step is a different act with a different
   * consequence.
   *=========================================*/
  it.each([
    ['sent', /already been sent/i],
    ['scheduled', /cancel the send first/i],
    ['sending', /being sent right now/i],
    ['canceled', /only a draft/i],
    ['failed', /only a draft/i],
  ])('refuses a %s email and keeps it', async (status, reason) => {
    seedDraft('email-1', { status })

    const result = await post({
      hostId: HOST,
      action: 'discardEmail',
      campaignId: 'email-1',
    })

    expect(result.status).toBe(409)
    expect(String(result.body.error)).toMatch(reason)
    expect(stored('campaigns/email-1')).toBeTruthy()
    expect(stored('campaigns/email-1')?.status).toBe(status)
  })

  it('answers 404 for an email that is not there', async () => {
    const result = await post({
      hostId: HOST,
      action: 'discardEmail',
      campaignId: 'ghost',
    })
    expect(result.status).toBe(404)
  })

  it('does not touch the campaign the draft belonged to', async () => {
    seedDraft('draft-1', { [CAMPAIGN_SEND_CONTAINER_FIELD]: CAMPAIGN })

    await post({
      hostId: HOST,
      action: 'discardEmail',
      campaignId: 'draft-1',
    })

    expect(stored(`emailCampaigns/${CAMPAIGN}`)).toBeTruthy()
  })
})
