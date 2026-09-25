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
 *
 * @jest-environment node
 */

import type { PluginRecordActivityRequest } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { FieldValue } from 'firebase-admin/firestore'
import { TRACKING_HOST_LINK_ROUTE, trackingHostPath } from '@aglyn/shared-util-email'
import { OUTREACH_CLICK_HUMAN_DELAY_MS } from '../engine/click-tracking'
import {
  isOutreachLinkId,
  mintOutreachClickToken,
  newOutreachLinkId,
  OUTREACH_CLICK_PATH,
  OUTREACH_LINK_ID_LENGTH,
  OUTREACH_SHORT_LINK_PATH,
  OUTREACH_TEST_LINK_ENROLLMENT,
  outreachClickUrl,
  outreachShortLinkUrl,
  outreachStoredLink,
  readOutreachClickToken,
  readOutreachStoredLink,
} from './click-link'
import { createOutreachClickRoute, createOutreachShortLinkRoute } from './click-route'
import { OUTREACH_ENROLLMENT_HISTORY, OUTREACH_ENROLLMENT_HISTORY_MAX } from '../model/outreach.types'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * THE LINK A RECIPIENT FOLLOWS (AGL-3239).
 *
 * The route answers with no session, so what is asserted here is what an
 * anonymous request gets: the right redirect for a signed token, no redirect
 * at all for anything else, and the counters that follow.
 *
 * The in-memory Firestore below understands `FieldValue.increment`, which
 * every counter in this feature is written with — a fake that stored the
 * sentinel instead would green a route that wrote garbage into the numbers a
 * rep reads.
 */

/*
 * The route itself reads a token with the PLATFORM's signing secret, since
 * that is what a recipient's request reaches it with; the spec sets the same
 * one in the environment rather than handing the route a stub, so what is
 * exercised is the default path a real click takes.
 */
const SECRET = 'a-signing-secret-for-the-spec'
process.env['EMAIL_UNSUBSCRIBE_SECRET'] = SECRET
const ORG = 'org-outreach'
const SEQUENCE = 'seq-1'
const ENROLLMENT = 'seq-1_contact-9'
const ORIGIN = 'https://console.example.com'
const TARGET = 'https://aglyn.com/pricing?utm_source=cold'
const SENT_AT = Date.parse('2026-09-22T14:00:00Z')

const SEQUENCE_PATH = `orgs/${ORG}/outreachSequences/${SEQUENCE}`
const ENROLLMENT_PATH = `orgs/${ORG}/outreachEnrollments/${ENROLLMENT}`
const ROLLUP_PATH = `${SEQUENCE_PATH}/reports/links`

type Data = Record<string, unknown>

let docs: Map<string, Data>
let clock: number
let filed: PluginRecordActivityRequest[]

/** Applies a write, resolving the increment sentinels the counters use. */
function merge(current: Data | undefined, patch: Data): Data {
  const next: Data = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValue) {
      const operand = (value as unknown as { operand: number }).operand
      next[key] = (Number(next[key]) || 0) + operand
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = merge(next[key] as Data | undefined, value as Data)
      continue
    }
    next[key] = value
  }
  return next
}

/** `a.b.c` paths, which `update` may use and `set` may not. */
function applyDotted(current: Data | undefined, patch: Data): Data {
  const flat: Data = {}
  const nested: Data = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) {
      flat[key] = value
      continue
    }
    const [head, ...rest] = key.split('.')
    const held = (nested[head] ?? {}) as Data
    let node = held
    for (let index = 0; index < rest.length - 1; index += 1) {
      node[rest[index]] = node[rest[index]] ?? {}
      node = node[rest[index]] as Data
    }
    node[rest[rest.length - 1]] = value
    nested[head] = held
  }
  return merge(merge(current, flat), nested)
}

function fakeFirestore(): FirebaseFirestore.Firestore {
  const snapshot = (path: string) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: docs.has(path),
    data: () => docs.get(path),
  })
  function ref(path: string): any {
    return {
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      collection: (name: string) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data: Data, options?: { merge?: boolean }) =>
        void docs.set(path, options?.merge ? applyDotted(docs.get(path), data) : applyDotted(undefined, data)),
      update: async (data: Data) => {
        if (!docs.has(path)) throw Object.assign(new Error(`NOT_FOUND ${path}`), { code: 5 })
        docs.set(path, applyDotted(docs.get(path), data))
      },
    }
  }
  function collection(path: string): any {
    return { doc: (id: string) => ref(`${path}/${id}`) }
  }
  return {
    collection,
    runTransaction: async (run: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await run({
        get: async (target: { path: string }) => snapshot(target.path),
        update: (target: { path: string }, data: Data) =>
          void writes.push(() => void docs.set(target.path, applyDotted(docs.get(target.path), data))),
        set: (target: { path: string }, data: Data, options?: { merge?: boolean }) =>
          void writes.push(() =>
            void docs.set(
              target.path,
              options?.merge ? applyDotted(docs.get(target.path), data) : applyDotted(undefined, data),
            ),
          ),
      })
      writes.forEach((apply) => apply())
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

/** The sequence touches the route stamped for the platform's join (AGL-3254). */
let touches: Array<{ hostId: string; email: string; campaignId: string; sequenceId: string; enrollmentId: string }>

const deps = (): Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'timeline' | 'campaignCredit'> => ({
  firestore: fakeFirestore,
  now: () => clock,
  timeline: () => ({
    async logActivity(request) {
      filed.push(request)
      return { ok: true, id: `a${filed.length}`, created: true }
    },
    async createTask() {
      return { ok: true, id: 't1', created: true }
    },
  }),
  campaignCredit: {
    credit: async () => undefined,
    attributeRecord: async () => undefined,
    recordTouch: async (input) => {
      touches.push(input)
    },
  },
})

/** A request as a mail client's browser makes one, hours after the send. */
function visit(
  token: string | null,
  overrides: { method?: string; userAgent?: string | null } = {},
): Request {
  const headers = new Headers()
  const agent =
    overrides.userAgent === undefined ? 'Mozilla/5.0 (Macintosh) Safari/605.1' : overrides.userAgent
  if (agent !== null) headers.set('user-agent', agent)
  return new Request(`${ORIGIN}${OUTREACH_CLICK_PATH}${token === null ? '' : `?t=${token}`}`, {
    method: overrides.method ?? 'GET',
    headers,
  })
}

const token = (overrides: Partial<Parameters<typeof mintOutreachClickToken>[0]> = {}) =>
  mintOutreachClickToken(
    {
      orgId: ORG,
      enrollmentId: ENROLLMENT,
      stepIndex: 0,
      linkIndex: 0,
      url: TARGET,
      ...overrides,
    },
    SECRET,
  ) as string

const call = (request: Request) =>
  createOutreachClickRoute(deps())(request, {} as never)

beforeEach(() => {
  clock = SENT_AT + 2 * 60 * 60 * 1000
  filed = []
  touches = []
  docs = new Map<string, Data>([
    [SEQUENCE_PATH, { id: SEQUENCE, stats: { sent: 3, people: 3, clickTracked: true } }],
    [
      ENROLLMENT_PATH,
      {
        id: ENROLLMENT,
        sequenceId: SEQUENCE,
        hostId: 'host-shop',
        contactId: 'contact-9',
        target: 'contact',
        email: 'lee@example.com',
        status: 'active',
        stepIndex: 1,
        updatedAtMs: SENT_AT,
        stepRecords: [{ stepIndex: 0, stepId: 's1', kind: 'email', atMs: SENT_AT }],
      },
    ],
  ])
})

describe('the click token', () => {
  it('round-trips what it was minted with', () => {
    expect(readOutreachClickToken(token(), SECRET)).toEqual({
      orgId: ORG,
      enrollmentId: ENROLLMENT,
      stepIndex: 0,
      linkIndex: 0,
      url: TARGET,
    })
  })

  it('does not verify under another secret, purpose or payload', () => {
    expect(readOutreachClickToken(token(), 'a-different-secret')).toBeNull()
    const [payload, signature] = token().split('.')
    // The destination swapped for another, the signature kept: the open
    // redirect this design exists to refuse.
    const swapped = Buffer.from(
      JSON.stringify({ v: 1, o: ORG, e: ENROLLMENT, s: 0, i: 0, u: 'https://evil.example/' }),
      'utf8',
    ).toString('base64url')
    expect(readOutreachClickToken(`${swapped}.${signature}`, SECRET)).toBeNull()
    expect(readOutreachClickToken(`${payload}.`, SECRET)).toBeNull()
    expect(readOutreachClickToken('', SECRET)).toBeNull()
  })

  it('refuses to sign a destination that is not http(s)', () => {
    for (const url of ['javascript:alert(1)', 'mailto:someone@example.com', 'ftp://example.com/x', '']) {
      expect(mintOutreachClickToken({ orgId: ORG, enrollmentId: ENROLLMENT, stepIndex: 0, linkIndex: 0, url }, SECRET)).toBeNull()
    }
  })

  it('mints nothing without an https console origin', () => {
    const target = { orgId: ORG, enrollmentId: ENROLLMENT, stepIndex: 0, linkIndex: 0, url: TARGET }
    expect(outreachClickUrl({ origin: 'http://console.example.com', target, secret: SECRET })).toBeNull()
    expect(outreachClickUrl({ origin: null, target, secret: SECRET })).toBeNull()
    expect(outreachClickUrl({ origin: ORIGIN, target, secret: SECRET })).toContain(OUTREACH_CLICK_PATH)
  })

  it('carries no address', () => {
    // A tracking URL lands in the recipient's history and in their gateway's
    // logs. It names the enrollment; looking the person up is ours to do.
    const minted = outreachClickUrl({
      origin: ORIGIN,
      target: { orgId: ORG, enrollmentId: ENROLLMENT, stepIndex: 0, linkIndex: 0, url: TARGET },
      secret: SECRET,
    }) as string
    const payload = Buffer.from(
      new URL(minted).searchParams.get('t')!.split('.')[0],
      'base64url',
    ).toString('utf8')
    expect(payload).not.toContain('lee@example.com')
    expect(payload).not.toContain('@')
  })
})

describe('the click route', () => {
  it('forwards a signed link to its destination', async () => {
    const answer = await call(visit(token()))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
    expect(answer.headers.get('Cache-Control')).toContain('no-store')
    expect(answer.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('refuses rather than guesses when the token does not verify', async () => {
    // There is nowhere to send them: the destination WAS the thing that
    // failed the check, so any redirect here would be an open one.
    for (const bad of [null, 'not-a-token', `${token()}x`]) {
      const answer = await call(visit(bad))
      expect(answer.status).toBe(400)
      expect(answer.headers.get('Location')).toBeNull()
    }
  })

  it('answers nothing but GET and HEAD', async () => {
    const answer = await call(new Request(`${ORIGIN}${OUTREACH_CLICK_PATH}?t=${token()}`, { method: 'POST' }))
    expect(answer.status).toBe(405)
  })

  it('counts a person’s click on the enrollment, the sequence and the link table', async () => {
    await call(visit(token()))
    const enrollment = docs.get(ENROLLMENT_PATH) as Data
    expect(enrollment['engagement']).toMatchObject({ clicks: 1, machineClicks: 0, lastClickUrl: 'https://aglyn.com/pricing' })
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toMatchObject({ clicks: 1, uniqueClicks: 1 })
    const rollup = docs.get(ROLLUP_PATH) as Data
    const rows = Object.values(rollup['links'] as Record<string, { url: string; clicks: number }>)
    // Keyed WITHOUT the query string, so a per-recipient `utm_source` cannot
    // mint one row per person.
    expect(rows).toEqual([{ url: 'https://aglyn.com/pricing', clicks: 1 }])
  })

  /*
   * A person's click on a sequence in a campaign is their last campaign
   * touch on the site (AGL-3254); a sequence outside every campaign stamps
   * nothing, and a scanner's fetch never does.
   */
  it('stamps a person’s click as a sequence touch under the sequence’s first campaign', async () => {
    docs.set(ENROLLMENT_PATH, {
      ...(docs.get(ENROLLMENT_PATH) as Data),
      campaignIds: ['founder-icp2', 'founder-icp1'],
    })
    await call(visit(token()))
    expect(touches).toEqual([
      {
        hostId: 'host-shop',
        email: 'lee@example.com',
        campaignId: 'founder-icp2',
        sequenceId: SEQUENCE,
        enrollmentId: ENROLLMENT,
        atMs: clock,
      },
    ])
  })

  it('stamps no touch for a sequence in no campaign, nor for a scanner', async () => {
    await call(visit(token()))
    docs.set(ENROLLMENT_PATH, { ...(docs.get(ENROLLMENT_PATH) as Data), campaignIds: ['founder-icp2'] })
    await call(visit(token(), { method: 'HEAD' }))
    expect(touches).toEqual([])
  })

  it('counts a second click but not a second unique one', async () => {
    await call(visit(token()))
    clock += 60_000
    await call(visit(token()))
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({ clicks: 2 })
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toMatchObject({ clicks: 2, uniqueClicks: 1 })
  })

  it('files the FIRST click on the person’s record and no later one', async () => {
    await call(visit(token()))
    clock += 60_000
    await call(visit(token()))
    expect(filed).toHaveLength(1)
    expect(filed[0]).toMatchObject({ kind: 'note', link: { contactId: 'contact-9' } })
  })

  it('redirects a scanner exactly as a person, and keeps its click out of the rate', async () => {
    // Refusing a security gateway is how it learns to report the link as
    // broken and the message as suspicious.
    const answer = await call(visit(token(), { userAgent: 'Proofpoint-Urlrewrite/2.0' }))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({ clicks: 0, machineClicks: 1 })
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toMatchObject({ machineClicks: 1 })
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).not.toHaveProperty('clicks')
    expect(docs.has(ROLLUP_PATH)).toBe(false)
    expect(filed).toHaveLength(0)
  })

  it('reads a click that lands seconds after the send as a machine’s', async () => {
    clock = SENT_AT + OUTREACH_CLICK_HUMAN_DELAY_MS - 1
    await call(visit(token()))
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({ clicks: 0, machineClicks: 1 })
  })

  it('does not touch `updatedAtMs`, which is what a member reads as activity', async () => {
    await call(visit(token(), { userAgent: 'Barracuda-Link-Protect' }))
    expect((docs.get(ENROLLMENT_PATH) as Data)['updatedAtMs']).toBe(SENT_AT)
  })

  it('still forwards when the enrollment is gone, and records nothing for them', async () => {
    // An erased person, or a deleted workspace. A promise to forget is not
    // undone by a click on an old email.
    docs.delete(ENROLLMENT_PATH)
    const answer = await call(visit(token()))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toEqual({ sent: 3, people: 3, clickTracked: true })
    expect(filed).toHaveLength(0)
    expect(historyRows()).toEqual([])
  })
})

/*==========================================
 * ONE PERSON'S HISTORY (AGL-3332): a row per visit, beside the totals.
 *=========================================*/

/** The enrollment's history rows, oldest first. */
function historyRows(): Data[] {
  return [...docs.keys()]
    .filter((key) => key.startsWith(`${ENROLLMENT_PATH}/${OUTREACH_ENROLLMENT_HISTORY}/`))
    .sort()
    .map((key) => docs.get(key) as Data)
}

describe('the click route: one person’s history (AGL-3332)', () => {
  it('writes a row for a person’s click: the destination as the link table keys it, the step, and when', async () => {
    await call(visit(token()))
    expect(historyRows()).toEqual([
      { kind: 'click', atMs: clock, url: 'https://aglyn.com/pricing', stepIndex: 0, human: true, machineReason: null },
    ])
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({
      clicks: 1,
      links: ['https://aglyn.com/pricing'],
      loggedClicks: 1,
      loggedMachineClicks: 0,
    })
  })

  it('writes a scanner’s visit too, with why it was read as one, and counts it apart', async () => {
    await call(visit(token(), { method: 'HEAD' }))
    expect(historyRows()).toEqual([
      { kind: 'click', atMs: clock, url: 'https://aglyn.com/pricing', stepIndex: 0, human: false, machineReason: 'method' },
    ])
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({
      clicks: 0,
      machineClicks: 1,
      links: [],
      loggedMachineClicks: 1,
    })
  })

  it('keeps each distinct destination once, in the order followed', async () => {
    await call(visit(token()))
    clock += 60_000
    await call(visit(token({ url: 'https://calendar.example.com/book?who=lee', linkIndex: 1 })))
    clock += 60_000
    await call(visit(token()))
    expect(historyRows().map((row) => row['url'])).toEqual([
      'https://aglyn.com/pricing',
      'https://calendar.example.com/book',
      'https://aglyn.com/pricing',
    ])
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({
      clicks: 3,
      links: ['https://aglyn.com/pricing', 'https://calendar.example.com/book'],
      loggedClicks: 3,
    })
  })

  it('itemizes from now on for a person whose earlier clicks were counted as totals', async () => {
    docs.set(ENROLLMENT_PATH, {
      ...(docs.get(ENROLLMENT_PATH) as Data),
      engagement: {
        clicks: 2,
        firstClickAtMs: SENT_AT + 60_000,
        lastClickAtMs: SENT_AT + 60_000,
        lastClickUrl: 'https://calendar.example.com/book',
        machineClicks: 0,
      },
    })
    await call(visit(token()))
    expect(historyRows()).toHaveLength(1)
    // The two earlier clicks stay a total: nothing is written for them.
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({
      clicks: 3,
      firstClickAtMs: SENT_AT + 60_000,
      links: ['https://aglyn.com/pricing'],
      loggedClicks: 1,
    })
  })

  it('stops itemizing at the history’s limit and keeps counting', async () => {
    docs.set(ENROLLMENT_PATH, {
      ...(docs.get(ENROLLMENT_PATH) as Data),
      engagement: {
        clicks: OUTREACH_ENROLLMENT_HISTORY_MAX,
        machineClicks: 0,
        loggedClicks: OUTREACH_ENROLLMENT_HISTORY_MAX,
        loggedMachineClicks: 0,
        firstClickAtMs: SENT_AT + 60_000,
        lastClickAtMs: SENT_AT + 60_000,
        lastClickUrl: 'https://aglyn.com/pricing',
        links: ['https://aglyn.com/pricing'],
      },
    })
    await call(visit(token()))
    expect(historyRows()).toEqual([])
    expect((docs.get(ENROLLMENT_PATH) as Data)['engagement']).toMatchObject({
      clicks: OUTREACH_ENROLLMENT_HISTORY_MAX + 1,
      loggedClicks: OUTREACH_ENROLLMENT_HISTORY_MAX,
    })
  })
})

/*==========================================
 * THE SHORT LINK (AGL-3297).
 *=========================================*/

const LINK_ID = 'Ab3dE9xK2q'
const LINK_PATH = `outreachLinks/${LINK_ID}`
const STORED = {
  orgId: ORG,
  enrollmentId: ENROLLMENT,
  stepIndex: 0,
  linkIndex: 0,
  url: TARGET,
}

const shortVisit = (id: string, overrides: { method?: string; userAgent?: string } = {}) =>
  new Request(`${ORIGIN}${OUTREACH_SHORT_LINK_PATH}/${id}`, {
    method: overrides.method ?? 'GET',
    headers: { 'user-agent': overrides.userAgent ?? 'Mozilla/5.0 (Macintosh) Safari/605.1' },
  })

const callShort = (request: Request, firestore: () => FirebaseFirestore.Firestore = fakeFirestore) =>
  createOutreachShortLinkRoute({ ...deps(), firestore })(request, {} as never)

describe('the short link id and document', () => {
  it('is ten characters of base 62, and a fresh one every time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOutreachLinkId()))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id).toHaveLength(OUTREACH_LINK_ID_LENGTH)
      expect(isOutreachLinkId(id)).toBe(true)
    }
    // Rejection sampling: a byte at or past 248 is never used.
    let calls = 0
    const bytes = () => {
      calls += 1
      return calls === 1 ? new Uint8Array(20).fill(255) : new Uint8Array(20).fill(1)
    }
    expect(newOutreachLinkId(bytes)).toBe('BBBBBBBBBB')
  })

  it('is a short link on an https console origin, and nothing else', () => {
    const url = outreachShortLinkUrl({ origin: `${ORIGIN}/`, linkId: LINK_ID })
    expect(url).toBe('https://console.example.com/api/outreach/l/Ab3dE9xK2q')
    expect(String(url).length).toBeLessThan(60)
    expect(outreachShortLinkUrl({ origin: 'http://console.example.com', linkId: LINK_ID })).toBeNull()
    expect(outreachShortLinkUrl({ origin: ORIGIN, linkId: '../x' })).toBeNull()
  })

  it('is on the sending domain’s verified links host when one is given (AGL-3306)', () => {
    expect(outreachShortLinkUrl({ origin: ORIGIN, linkId: LINK_ID, trackingOrigin: 'https://links.acme.io' })).toBe(
      'https://links.acme.io/Ab3dE9xK2q',
    )
    // Anything but an https origin falls back to the console, never to nothing.
    for (const trackingOrigin of [null, '', 'http://links.acme.io', 'not a url']) {
      expect(outreachShortLinkUrl({ origin: ORIGIN, linkId: LINK_ID, trackingOrigin })).toBe(
        'https://console.example.com/api/outreach/l/Ab3dE9xK2q',
      )
    }
    expect(outreachShortLinkUrl({ origin: ORIGIN, linkId: '../x', trackingOrigin: 'https://links.acme.io' })).toBeNull()
  })

  it('resolves on the very route the links host rewrites to', () => {
    // The console middleware rewrites `links.<domain>/<id>` to this path; a
    // rename on either side would leave every link on the host answering 404.
    expect(TRACKING_HOST_LINK_ROUTE).toBe(OUTREACH_SHORT_LINK_PATH)
    expect(trackingHostPath(`/${LINK_ID}`)).toEqual({ kind: 'link', rewrite: `${OUTREACH_SHORT_LINK_PATH}/${LINK_ID}` })
  })

  it('stores only a destination we would follow, and reads back what it stored', () => {
    const doc = outreachStoredLink(STORED, 5)
    expect(doc).toEqual({ v: 1, ...STORED, createdAtMs: 5 })
    expect(readOutreachStoredLink(doc)).toEqual(STORED)
    for (const url of ['javascript:alert(1)', 'mailto:someone@example.com', '']) {
      expect(outreachStoredLink({ ...STORED, url }, 5)).toBeNull()
      expect(readOutreachStoredLink({ ...doc, url })).toBeNull()
    }
    expect(readOutreachStoredLink({ ...doc, v: 2 })).toBeNull()
    expect(readOutreachStoredLink(null)).toBeNull()
  })

  it('keeps a test link’s mark, and reads it back only as the boolean it wrote (AGL-3325)', () => {
    const doc = outreachStoredLink({ ...STORED, enrollmentId: OUTREACH_TEST_LINK_ENROLLMENT, test: true }, 5)
    expect(doc).toMatchObject({ test: true, enrollmentId: 'test' })
    expect(readOutreachStoredLink(doc)).toMatchObject({ test: true })
    expect(readOutreachStoredLink({ ...doc, test: 'yes' })).not.toHaveProperty('test')
    expect(outreachStoredLink(STORED, 5)).not.toHaveProperty('test')
  })
})

describe('the short link route', () => {
  beforeEach(() => {
    docs.set(LINK_PATH, { v: 1, ...STORED, createdAtMs: SENT_AT })
  })

  it('forwards to the stored destination with the signed route’s headers', async () => {
    const answer = await callShort(shortVisit(LINK_ID))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
    expect(answer.headers.get('Cache-Control')).toContain('no-store')
    expect(answer.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('follows a test link and records nothing, whoever clicks it (AGL-3325)', async () => {
    docs.set(LINK_PATH, { v: 1, ...STORED, enrollmentId: OUTREACH_TEST_LINK_ENROLLMENT, test: true, createdAtMs: SENT_AT })
    const before = JSON.stringify([...docs.entries()])
    const answer = await callShort(shortVisit(LINK_ID))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
    clock += 60_000
    await callShort(shortVisit(LINK_ID))
    expect(JSON.stringify([...docs.entries()])).toBe(before)
    expect(filed).toEqual([])
    expect(touches).toEqual([])
  })

  it('counts clicks exactly as the signed link does: once per person', async () => {
    await callShort(shortVisit(LINK_ID))
    clock += 60_000
    await callShort(shortVisit(LINK_ID))
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toMatchObject({ clicks: 2, uniqueClicks: 1 })
    expect(filed).toHaveLength(1)
  })

  it('stamps the campaign touch for a person, and a scanner is redirected but counted apart', async () => {
    docs.set(ENROLLMENT_PATH, { ...(docs.get(ENROLLMENT_PATH) as Data), campaignIds: ['founder-icp2'] })
    const scanned = await callShort(shortVisit(LINK_ID, { userAgent: 'Proofpoint-Urlrewrite/2.0' }))
    expect(scanned.headers.get('Location')).toBe(TARGET)
    expect(touches).toEqual([])
    await callShort(shortVisit(LINK_ID))
    expect(touches).toHaveLength(1)
    expect((docs.get(SEQUENCE_PATH) as Data)['stats']).toMatchObject({ uniqueClicks: 1, machineClicks: 1 })
  })

  it('follows nothing an id does not name: no open redirect', async () => {
    for (const id of ['Zz9Zz9Zz9Z', 'short', 'Ab3dE9xK2q2', '..%2F..%2Fx']) {
      const answer = await callShort(shortVisit(id))
      expect(answer.status).toBe(400)
      expect(answer.headers.get('Location')).toBeNull()
    }
    // A stored document that is not one we would follow is refused too.
    docs.set(LINK_PATH, { v: 1, ...STORED, url: 'javascript:alert(1)' })
    expect((await callShort(shortVisit(LINK_ID))).headers.get('Location')).toBeNull()
  })

  it('answers a failed read with a page, never a guess', async () => {
    const failing = () =>
      ({
        collection: () => ({ doc: () => ({ get: async () => Promise.reject(new Error('unavailable')) }) }),
      }) as unknown as FirebaseFirestore.Firestore
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const answer = await callShort(shortVisit(LINK_ID), failing)
    expect(answer.status).toBe(503)
    expect(answer.headers.get('Location')).toBeNull()
  })

  it('answers nothing but GET and HEAD', async () => {
    expect((await callShort(shortVisit(LINK_ID, { method: 'POST' }))).status).toBe(405)
  })

  it('keeps answering the long signed links already in inboxes', async () => {
    const answer = await call(visit(token()))
    expect(answer.status).toBe(302)
    expect(answer.headers.get('Location')).toBe(TARGET)
  })
})
