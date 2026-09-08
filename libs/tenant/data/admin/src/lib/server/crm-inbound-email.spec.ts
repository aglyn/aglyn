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
 * Email capture's Firestore half (AGL-2657), over an in-memory store: the
 * token is minted once and replaced on a rotation; a message is filed on
 * the contact or the lead its correspondent is, with the record's own
 * scope; a second delivery is a no-op; a message with nobody the org knows
 * is unmatched; a full log refuses. `@aglyn/aglyn/server` is REAL — the
 * candidate rule, the excerpt and the row are the rules under test.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))

import { CRM_ACTIVITIES_PER_RECORD_CEILING, personKey } from '@aglyn/aglyn/server'
import type { ReceivedEmail } from '@aglyn/shared-util-email'
import {
  ensureCrmInboundToken,
  fileCrmInboundEmail,
  findOrgByCrmInboundToken,
} from './crm-inbound-email'

// ---------------------------------------------------------------------------
// The store: nested collections, equality filters (dotted paths included),
// a limit, an aggregate count, create-once, and a transaction.
// ---------------------------------------------------------------------------

const store = new Map<string, Record<string, any>>()
let autoId = 0

const last = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
const readPath = (data: Record<string, any>, field: string): unknown =>
  field.split('.').reduce<any>((cursor, part) => cursor?.[part], data)

function snapshot(path: string) {
  const data = store.get(path)
  return {
    id: last(path),
    ref: docRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? readPath(data, field) : undefined),
  }
}

function docRef(path: string): any {
  return {
    id: last(path),
    path,
    get parent() {
      return collectionRef(parentOf(path))
    },
    get: async () => snapshot(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      store.set(path, options?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data })
    },
    update: async (data: Record<string, any>) => {
      if (!store.has(path)) throw new Error(`NOT_FOUND: ${path}`)
      store.set(path, { ...(store.get(path) as Record<string, any>), ...data })
    },
    create: async (data: Record<string, any>) => {
      if (store.has(path)) {
        const error: Error & { code?: number } = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      store.set(path, { ...data })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function children(path: string): string[] {
  const prefix = `${path}/`
  return [...store.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function query(path: string, filters: Array<[string, unknown]>, limitN: number | null): any {
  const matches = () =>
    children(path).filter((key) =>
      filters.every(([field, value]) => readPath(store.get(key) as Record<string, any>, field) === value),
    )
  return {
    where: (field: string, _op: string, value: unknown) =>
      query(path, [...filters, [field, value]], limitN),
    limit: (n: number) => query(path, filters, n),
    count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
    get: async () => {
      const keys = matches()
      return { docs: (limitN ? keys.slice(0, limitN) : keys).map((key) => snapshot(key)) }
    },
  }
}

function collectionRef(path: string): any {
  return {
    path,
    get parent() {
      return path.includes('/') ? docRef(parentOf(path)) : null
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
    where: (field: string, _op: string, value: unknown) => query(path, [[field, value]], null),
    limit: (n: number) => query(path, [], n),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (ref: { path: string }) => snapshot(ref.path),
      update: (ref: { path: string }, data: Record<string, any>) => {
        store.set(ref.path, { ...(store.get(ref.path) as Record<string, any>), ...data })
      },
    }),
} as unknown as FirebaseFirestore.Firestore

// ---------------------------------------------------------------------------

const ORG = 'org-1'
const DOMAIN = 'in.aglyn.com'
const TOKEN = 'k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3'
const CAPTURE = `crm+${TOKEN}@in.aglyn.com`
const MEMBERS = [
  { uid: 'u-sam', email: 'Sam@Acme.com', name: 'Sam Rep' },
  { uid: 'u-kim', email: 'kim@acme.com', name: 'Kim' },
]

const message = (overrides: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  id: 'em-1',
  messageId: '<abc@mail.example>',
  inReplyTo: '<prev@acme.com>',
  from: 'Ada Lovelace <ada@example.com>',
  to: ['Sam Rep <sam@acme.com>', CAPTURE],
  cc: [],
  bcc: [],
  receivedFor: [],
  subject: 'Re: Renewal',
  text: 'October, please.\n\nOn Mon, Sep 7, 2026 Sam Rep <sam@acme.com> wrote:\n> September?',
  html: '',
  receivedAtMs: 1_757_300_000_000,
  ...overrides,
})

const file = (msg: ReceivedEmail, hostIds = ['site-1', 'site-2']) =>
  fileCrmInboundEmail(firestore, {
    orgId: ORG,
    org: store.get(`orgs/${ORG}`) as Record<string, unknown>,
    message: msg,
    domain: DOMAIN,
    members: MEMBERS,
    hostIds,
  })

const activities = () => children(`orgs/${ORG}/crmActivities`).map((key) => store.get(key))

beforeEach(() => {
  store.clear()
  autoId = 0
  store.set(`orgs/${ORG}`, { name: 'Acme', plan: 'agency' })
  store.set(`orgs/${ORG}/contacts/con-1`, {
    email: 'ada@example.com',
    hostId: 'site-1',
    visibleTo: ['host:site-1'],
    facets: { 'site-1': { companyId: 'co-1', sources: {}, interactions: [] } },
  })
  store.set(`hosts/site-2/leads/${personKey('bob@lead.example')}`, {
    email: 'bob@lead.example',
    name: 'Bob',
  })
})

describe('the capture token', () => {
  it('mints one the first time, keeps it after, and replaces it on a rotation', async () => {
    const first = await ensureCrmInboundToken(firestore, ORG, { nowMs: 1_000 })
    expect(first.rotated).toBe(false)
    expect(first.token).toMatch(/^[a-z0-9]{32}$/)
    expect(first.createdAtMs).toBe(1_000)
    expect(store.get(`orgs/${ORG}`)?.['crmInbound']).toEqual({
      token: first.token,
      createdAtMs: 1_000,
    })

    const again = await ensureCrmInboundToken(firestore, ORG, { nowMs: 2_000 })
    expect(again.token).toBe(first.token)
    expect(again.createdAtMs).toBe(1_000)

    const rotated = await ensureCrmInboundToken(firestore, ORG, { rotate: true, nowMs: 3_000 })
    expect(rotated.rotated).toBe(true)
    expect(rotated.token).not.toBe(first.token)
    expect(rotated.createdAtMs).toBe(1_000)
    expect(rotated.rotatedAtMs).toBe(3_000)
    expect(store.get(`orgs/${ORG}`)?.['crmInbound']).toEqual({
      token: rotated.token,
      createdAtMs: 1_000,
      rotatedAtMs: 3_000,
    })
  })

  it('refuses an org that does not exist', async () => {
    await expect(ensureCrmInboundToken(firestore, 'org-none')).rejects.toThrow('unknown org')
  })

  it('finds the org by its token, and nothing for a malformed or unknown one', async () => {
    store.set(`orgs/${ORG}`, { ...store.get(`orgs/${ORG}`), crmInbound: { token: TOKEN, createdAtMs: 1 } })
    store.set('orgs/org-2', { crmInbound: { token: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', createdAtMs: 1 } })
    expect((await findOrgByCrmInboundToken(firestore, TOKEN))?.orgId).toBe(ORG)
    expect(await findOrgByCrmInboundToken(firestore, 'x'.repeat(10))).toBeNull()
    expect(await findOrgByCrmInboundToken(firestore, 'z'.repeat(32))).toBeNull()
  })
})

describe('filing a message', () => {
  it("files a contact's reply as inbound, with the record's scope, the excerpt and the thread facts", async () => {
    const result = await file(message())
    expect(result.outcome).toBe('filed')
    if (result.outcome !== 'filed') return
    expect(result.match).toMatchObject({
      email: 'ada@example.com',
      direction: 'inbound',
      kind: 'contact',
      link: { contactId: 'con-1', companyId: 'co-1' },
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
    })
    const rows = activities()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      kind: 'email',
      subject: 'Re: Renewal',
      body: 'October, please.',
      direction: 'inbound',
      from: 'ada@example.com',
      to: 'sam@acme.com',
      messageId: '<abc@mail.example>',
      inReplyTo: '<prev@acme.com>',
      threadSubject: 'Renewal',
      atMs: 1_757_300_000_000,
      byUid: '',
      contactId: 'con-1',
      companyId: 'co-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    })
    // The lookup wrote the address index entry on its way past.
    expect(store.get(`orgs/${ORG}/emailIndex/${personKey('ada@example.com')}`)).toMatchObject({
      contactId: 'con-1',
    })
  })

  it('answers duplicate for a second delivery of the same Message-ID and writes nothing more', async () => {
    const first = await file(message())
    const second = await file(message({ id: 'em-redelivered' }))
    expect(second).toEqual({
      outcome: 'duplicate',
      activityId: first.outcome === 'filed' ? first.activityId : '',
    })
    expect(activities()).toHaveLength(1)
  })

  it('keys a message with no Message-ID on the provider id, and one with neither on a fresh id', async () => {
    await file(message({ messageId: '' }))
    expect((await file(message({ messageId: '' }))).outcome).toBe('duplicate')
    await file(message({ id: '', messageId: '' }))
    await file(message({ id: '', messageId: '' }))
    expect(activities()).toHaveLength(3)
  })

  it("files a member's copied send to a lead as outbound, on the lead, stamped with the member and the site's scope", async () => {
    const result = await file(
      message({
        from: 'Sam Rep <sam@acme.com>',
        to: ['Bob <bob@lead.example>'],
        bcc: [CAPTURE],
        subject: 'Renewal',
        text: 'Shall we talk Tuesday?\n\nSent from my iPhone',
        messageId: '<out@acme.com>',
        inReplyTo: '',
      }),
    )
    expect(result.outcome).toBe('filed')
    if (result.outcome !== 'filed') return
    expect(result.match).toMatchObject({
      kind: 'lead',
      direction: 'outbound',
      link: { leadId: personKey('bob@lead.example') },
      hostId: 'site-2',
      visibleTo: ['host:site-2'],
    })
    expect(activities()[0]).toMatchObject({
      direction: 'outbound',
      from: 'sam@acme.com',
      to: 'bob@lead.example',
      body: 'Shall we talk Tuesday?',
      byUid: 'u-sam',
      byName: 'Sam Rep',
      leadId: personKey('bob@lead.example'),
      hostId: 'site-2',
    })
    expect('inReplyTo' in (activities()[0] as object)).toBe(false)
  })

  it("files a forwarded reply on the contact the forwarded block's From names, as inbound", async () => {
    const result = await file(
      message({
        from: 'Sam Rep <sam@acme.com>',
        to: [CAPTURE],
        subject: 'Fwd: Renewal',
        text: [
          'FYI',
          '',
          '---------- Forwarded message ---------',
          'From: Ada Lovelace <ada@example.com>',
          'Date: Mon, Sep 7, 2026 at 2:00 PM',
          'Subject: Re: Renewal',
          'To: Sam Rep <sam@acme.com>',
          '',
          'Could we push to October?',
        ].join('\n'),
        messageId: '<fwd@acme.com>',
      }),
    )
    expect(result.outcome).toBe('filed')
    expect(activities()[0]).toMatchObject({
      direction: 'inbound',
      from: 'sam@acme.com',
      contactId: 'con-1',
      body: 'Could we push to October?',
      threadSubject: 'Renewal',
    })
  })

  it('is unmatched when nobody on the message is a record, naming only the sender domain', async () => {
    const result = await file(message({ from: 'Nobody <nobody@stranger.example>', to: [CAPTURE] }))
    expect(result).toEqual({ outcome: 'unmatched', senderDomain: 'stranger.example' })
    expect(activities()).toHaveLength(0)
  })

  it('is unmatched when the only addresses are members and the capture address', async () => {
    const result = await file(message({ from: 'sam@acme.com', to: ['kim@acme.com', CAPTURE] }))
    expect(result.outcome).toBe('unmatched')
  })

  it('refuses at the record’s activity ceiling rather than writing past it', async () => {
    for (let index = 0; index < CRM_ACTIVITIES_PER_RECORD_CEILING; index += 1) {
      store.set(`orgs/${ORG}/crmActivities/old-${index}`, { kind: 'note', contactId: 'con-1' })
    }
    const result = await file(message())
    expect(result.outcome).toBe('ceiling')
    expect(activities()).toHaveLength(CRM_ACTIVITIES_PER_RECORD_CEILING)
  })

  it('reads the words of the HTML part when the text part is empty', async () => {
    const result = await file(
      message({ text: '', html: '<div>Hello <b>there</b></div><div>Bye</div>' }),
    )
    expect(result.outcome).toBe('filed')
    expect(activities()[0]).toMatchObject({ body: 'Hello there\nBye' })
  })
})
