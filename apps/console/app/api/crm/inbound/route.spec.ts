/**
 * @jest-environment node
 */
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
 * The capture webhook (AGL-2657), driven end to end over an in-memory
 * Firestore with a signed fixture: a valid delivery files one row on the
 * contact; a bad signature is refused before anything is read; a message
 * nobody knows is acknowledged and noted by its sender's domain alone; a
 * second delivery of one Message-ID writes nothing. `@aglyn/aglyn/server`
 * and the admin lib's filing modules are REAL — the matching is the thing
 * under test — and the provider's reader is the module's own seam.
 */

export {}

// ---------------------------------------------------------------------------
// The store, as `crm-inbound-email.spec.ts` models it.
// ---------------------------------------------------------------------------

const mockStore = new Map<string, Record<string, any>>()
let mockAutoId = 0

const mockLast = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const mockParent = (path: string) => path.slice(0, path.lastIndexOf('/'))
const mockRead = (data: Record<string, any>, field: string): unknown =>
  field.split('.').reduce<any>((cursor, part) => cursor?.[part], data)

function mockSnapshot(path: string) {
  const data = mockStore.get(path)
  return {
    id: mockLast(path),
    ref: mockDocRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? mockRead(data, field) : undefined),
  }
}

function mockDocRef(path: string): any {
  return {
    id: mockLast(path),
    path,
    get parent() {
      return mockCollectionRef(mockParent(path))
    },
    get: async () => mockSnapshot(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      mockStore.set(
        path,
        options?.merge ? { ...(mockStore.get(path) ?? {}), ...data } : { ...data },
      )
    },
    update: async (data: Record<string, any>) => {
      mockStore.set(path, { ...(mockStore.get(path) as Record<string, any>), ...data })
    },
    create: async (data: Record<string, any>) => {
      if (mockStore.has(path)) {
        const error: Error & { code?: number } = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      mockStore.set(path, { ...data })
    },
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
  }
}

function mockChildren(path: string): string[] {
  const prefix = `${path}/`
  return [...mockStore.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockQuery(path: string, filters: Array<[string, unknown]>, limitN: number | null): any {
  const matches = () =>
    mockChildren(path).filter((key) =>
      filters.every(
        ([field, value]) => mockRead(mockStore.get(key) as Record<string, any>, field) === value,
      ),
    )
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(path, [...filters, [field, value]], limitN),
    limit: (n: number) => mockQuery(path, filters, n),
    count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
    get: async () => {
      const keys = matches()
      return { docs: (limitN ? keys.slice(0, limitN) : keys).map((key) => mockSnapshot(key)) }
    },
  }
}

function mockCollectionRef(path: string): any {
  return {
    path,
    get parent() {
      return path.includes('/') ? mockDocRef(mockParent(path)) : null
    },
    doc: (id?: string) => mockDocRef(`${path}/${id ?? `auto-${(mockAutoId += 1)}`}`),
    where: (field: string, _op: string, value: unknown) => mockQuery(path, [[field, value]], null),
    limit: (n: number) => mockQuery(path, [], n),
  }
}

const mockFirestore = {
  collection: (name: string) => mockCollectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      update: (ref: { path: string }, data: Record<string, any>) => {
        mockStore.set(ref.path, { ...(mockStore.get(ref.path) as Record<string, any>), ...data })
      },
    }),
}

const mockOrgActivity: unknown[][] = []
let mockFlagOn = true

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '<server-timestamp>' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/tenant-data-admin/server/crm-inbound-email'),
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  getServerReleaseFlagValues: async () => ({
    release_contacts: mockFlagOn ? { enabled: true } : { enabled: false },
  }),
  listOrgMembers: async (orgId: string) =>
    mockChildren(`orgs/${orgId}/members`).map((path) => ({
      $id: mockLast(path),
      ...mockStore.get(path),
    })),
  logOrgActivity: async (...args: unknown[]) => {
    mockOrgActivity.push(args)
  },
}))

// ---------------------------------------------------------------------------

import { CRM_INBOUND_UNMATCHED_ACTION, personKey } from '@aglyn/aglyn/server'
import { type ReceivedEmail, signSvixPayload } from '@aglyn/shared-util-email'
import { POST, inboundWebhookSecrets, setInboundReaderForTesting } from './route'

const URL = 'https://app.aglyn.com/api/crm/inbound'
const SECRET = `whsec_${Buffer.from('capture-endpoint-secret-for-the-spec').toString('base64')}`
const OTHER_SECRET = `whsec_${Buffer.from('delivery-endpoint-secret-for-the-spec').toString('base64')}`
const ORG = 'org-1'
const TOKEN = 'k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3'
const CAPTURE = `crm+${TOKEN}@in.aglyn.com`

const messages = new Map<string, ReceivedEmail>()
const reads: string[] = []

const received = (id: string, overrides: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
  id,
  messageId: `<${id}@mail.example>`,
  inReplyTo: '',
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

/** Resend's `email.received` event for a message the reader will answer. */
function event(id: string, recipients: string[] = ['sam@acme.com', CAPTURE]) {
  return {
    type: 'email.received',
    created_at: '2026-09-07T23:41:12.126Z',
    data: {
      email_id: id,
      created_at: '2026-09-07T23:41:11.894Z',
      from: 'Ada Lovelace <ada@example.com>',
      to: recipients,
      cc: [],
      bcc: [],
      received_for: [],
      message_id: `<${id}@mail.example>`,
      subject: 'Re: Renewal',
      attachments: [],
    },
  }
}

function deliver(
  body: unknown,
  options: { secret?: string | null; id?: string; timestamp?: string } = {},
) {
  const { secret = SECRET, id = 'msg_1', timestamp = '1757300000' } = options
  const raw = JSON.stringify(body)
  return POST(
    new Request(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': secret ? signSvixPayload(secret, id, timestamp, raw) : 'v1,bad',
      },
      body: raw,
    }),
  )
}

const rows = () => mockChildren(`orgs/${ORG}/crmActivities`).map((key) => mockStore.get(key))

beforeEach(() => {
  mockStore.clear()
  mockAutoId = 0
  mockOrgActivity.length = 0
  messages.clear()
  reads.length = 0
  mockFlagOn = true
  process.env['CRM_INBOUND_WEBHOOK_SECRET'] = SECRET
  process.env['RESEND_WEBHOOK_SECRET'] = OTHER_SECRET
  process.env['RESEND_READ_API_KEY'] = 're_full'
  delete process.env['CRM_INBOUND_DOMAIN']
  setInboundReaderForTesting((apiKey) => async (id) => {
    reads.push(`${apiKey}:${id}`)
    return messages.get(id) ?? null
  })
  mockStore.set(`orgs/${ORG}`, {
    name: 'Acme',
    plan: 'agency',
    crmInbound: { token: TOKEN, createdAtMs: 1 },
  })
  mockStore.set(`orgs/${ORG}/members/u-sam`, { role: 'editor', email: 'sam@acme.com', displayName: 'Sam Rep' })
  mockStore.set(`orgs/${ORG}/contacts/con-1`, {
    email: 'ada@example.com',
    hostId: 'site-1',
    visibleTo: ['host:site-1'],
  })
  mockStore.set('hosts/site-1', { orgId: ORG })
  mockStore.set(`hosts/site-1/leads/${personKey('bob@lead.example')}`, { email: 'bob@lead.example' })
})

afterAll(() => {
  setInboundReaderForTesting(null)
})

describe('POST /api/crm/inbound', () => {
  it('files a signed delivery on the contact its sender is, as an inbound email', async () => {
    messages.set('em-1', received('em-1'))
    const response = await deliver(event('em-1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      filed: true,
      activityId: expect.stringMatching(/^cap_[0-9a-f]{28}$/),
      direction: 'inbound',
      kind: 'contact',
    })
    expect(reads).toEqual(['re_full:em-1'])
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({
      kind: 'email',
      direction: 'inbound',
      from: 'ada@example.com',
      to: 'sam@acme.com',
      subject: 'Re: Renewal',
      body: 'October, please.',
      messageId: '<em-1@mail.example>',
      threadSubject: 'Renewal',
      contactId: 'con-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      byUid: '',
    })
    expect(mockOrgActivity).toEqual([])
  })

  it('accepts the delivery-events endpoint’s secret too, and refuses a bad signature before any read', async () => {
    messages.set('em-2', received('em-2'))
    expect((await deliver(event('em-2'), { secret: OTHER_SECRET })).status).toBe(200)
    const refused = await deliver(event('em-2'), { secret: null })
    expect(refused.status).toBe(401)
    const forged = await deliver(event('em-2'), {
      secret: `whsec_${Buffer.from('somebody-else').toString('base64')}`,
    })
    expect(forged.status).toBe(401)
    expect(reads).toEqual(['re_full:em-2'])
    expect(inboundWebhookSecrets({ RESEND_WEBHOOK_SECRET: 'a', CRM_INBOUND_WEBHOOK_SECRET: 'a' })).toEqual(['a'])
  })

  it('answers 501 with no secret at all, and with no read key', async () => {
    delete process.env['CRM_INBOUND_WEBHOOK_SECRET']
    delete process.env['RESEND_WEBHOOK_SECRET']
    expect((await deliver(event('em-3'))).status).toBe(501)
    process.env['CRM_INBOUND_WEBHOOK_SECRET'] = SECRET
    delete process.env['RESEND_READ_API_KEY']
    const response = await deliver(event('em-3'))
    expect(response.status).toBe(501)
    expect(reads).toEqual([])
  })

  it('acknowledges an event that is not a received message, and one naming no capture address', async () => {
    const other = await deliver({ type: 'email.delivered', data: { email_id: 'em-4' } })
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ ignored: true, reason: 'not-received-event' })
    const stray = await deliver(event('em-4', ['sam@acme.com']))
    expect(stray.status).toBe(202)
    expect(await stray.json()).toEqual({ filed: false, reason: 'no-token' })
    expect(reads).toEqual([])
  })

  it('acknowledges a token nobody holds, and a workspace whose CRM is off, without reading the message', async () => {
    const unknown = await deliver(event('em-5', [`crm+${'z'.repeat(32)}@in.aglyn.com`]))
    expect(unknown.status).toBe(202)
    expect(await unknown.json()).toEqual({ filed: false, reason: 'unknown-token' })
    mockFlagOn = false
    const off = await deliver(event('em-5'))
    expect(off.status).toBe(202)
    expect(await off.json()).toEqual({ filed: false, reason: 'release-flag' })
    expect(reads).toEqual([])
  })

  it('notes an unmatched message in the org’s feed by its sender’s domain, never its body', async () => {
    messages.set(
      'em-6',
      received('em-6', {
        from: 'Nobody <nobody@stranger.example>',
        to: [CAPTURE],
        text: 'SECRET BODY that must not be logged',
      }),
    )
    const response = await deliver(event('em-6'))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ filed: false, reason: 'unmatched' })
    expect(rows()).toHaveLength(0)
    expect(mockOrgActivity).toEqual([
      [ORG, { uid: null }, CRM_INBOUND_UNMATCHED_ACTION, { type: 'contact', name: 'stranger.example' }],
    ])
    expect(JSON.stringify(mockOrgActivity)).not.toContain('SECRET BODY')
  })

  it('writes nothing for a second delivery of the same Message-ID', async () => {
    messages.set('em-7', received('em-7'))
    expect((await deliver(event('em-7'))).status).toBe(200)
    const again = await deliver(event('em-7'), { id: 'msg_redelivered' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({
      filed: false,
      reason: 'duplicate',
      activityId: expect.stringMatching(/^cap_/),
    })
    expect(rows()).toHaveLength(1)
  })

  it("files a member's copied send on a lead as outbound, stamped with the member", async () => {
    messages.set(
      'em-8',
      received('em-8', {
        from: 'Sam Rep <sam@acme.com>',
        to: ['Bob <bob@lead.example>'],
        bcc: [CAPTURE],
        subject: 'Renewal',
        text: 'Tuesday?',
      }),
    )
    const response = await deliver(event('em-8', ['bob@lead.example', CAPTURE]))
    expect(await response.json()).toMatchObject({ filed: true, direction: 'outbound', kind: 'lead' })
    expect(rows()[0]).toMatchObject({
      direction: 'outbound',
      byUid: 'u-sam',
      byName: 'Sam Rep',
      leadId: personKey('bob@lead.example'),
      to: 'bob@lead.example',
      body: 'Tuesday?',
    })
  })

  it('acknowledges a message the provider no longer has', async () => {
    const response = await deliver(event('em-gone'))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ filed: false, reason: 'message-gone' })
  })
})
