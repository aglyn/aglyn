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

/**
 * COMMERCE MARKETING MAIL NAMES ITS SENDER'S CONSENT GROUP (AGL-3310).
 *
 * A cart reminder, a restock alert and a member post each go through
 * `sendEmail`'s marketing gate, and the gate reads an unsubscribe, a stream
 * left or a pace asked for on ANY site of the sender's consent group — the
 * sites an org declared one sender. It can only do that if the sender names
 * them. Each of these reads the owning org already (for the plan, the
 * brand), so the group comes off that read and costs nothing; this file pins
 * that the value handed over is the declared group, and the site alone for an
 * org that declared none — and, with it, whether the org said the group waits
 * for a confirmation click (AGL-3316).
 */

/** Every marketing context the senders handed to `sendEmail`. */
let contexts: Array<Record<string, any>> = []
/** Collection name → the docs a query on it answers with. */
let rows: Record<string, any[]> = {}
/** Document path → its stored fields. */
let stored: Record<string, Record<string, any>> = {}
/** The owning org — its `consentGroups` declaration is what a case varies. */
let mockOrg: Record<string, unknown> = { plan: 'pro' }

const gate = { isLocked: async () => false }

function snapshotFor(path: string) {
  return {
    id: path.split('/').pop(),
    exists: path in stored,
    data: () => stored[path],
    get: (field: string) => stored[path]?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    // `hosts/{hostId}/{collection}/{id}` — the grandparent is the host, and
    // a sweep reads and addresses it. A getter, so a reference is only ever
    // built for the ancestor somebody asks for.
    get parent() {
      return { parent: docRef(path.split('/').slice(0, -2).join('/')) }
    },
    get: async () => snapshotFor(path),
    set: async (value: Record<string, any>) => {
      stored[path] = { ...(stored[path] ?? {}), ...value }
    },
    add: async (value: Record<string, any>) => {
      stored[`${path}/new`] = value
      return docRef(`${path}/new`)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function query(name: string): any {
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => ({ size: (rows[name] ?? []).length, docs: rows[name] ?? [] }),
  }
  return chain
}

function collectionRef(path: string): any {
  const ref: any = query(path.split('/').pop() as string)
  ref.path = path
  ref.doc = (id: string) => docRef(`${path}/${id}`)
  ref.add = async (value: Record<string, any>) => {
    stored[`${path}/added`] = value
    return docRef(`${path}/added`)
  }
  return ref
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => query(name),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => firestore,
      auth: () => ({ verifyIdToken: async () => ({ uid: 'admin-uid' }) }),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => 'NOW' },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  meterHostEmail: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  loadHostEmail: async () => null,
  sendEmail: async (message: { marketing?: Record<string, any> }) => {
    if (message.marketing) contexts.push(message.marketing)
    return { sent: true }
  },
}))

import { memberPostHandler } from './member-post'
import { scanAbandonedCheckouts } from './process-abandoned'
import { scanRestockAlerts } from './process-restock'

const SITE_A = 'site-a'
const SITE_B = 'site-b'
const DECLARED = {
  plan: 'pro',
  consentGroups: { acme: { name: 'Acme', hostIds: [SITE_A, SITE_B] } },
}

/** A document snapshot living at `hosts/{hostId}/{collection}/{id}`. */
function hostDoc(collection: string, id: string, data: Record<string, any>) {
  const path = `hosts/${SITE_A}/${collection}/${id}`
  stored[path] = data
  return {
    id,
    data: () => stored[path],
    get: (field: string) => stored[path]?.[field],
    ref: docRef(path),
  }
}

/** A checkout left two hours ago: past the reminder delay, well inside the give-up. */
const leftCart = () => {
  rows['checkouts'] = [
    hostDoc('checkouts', 'c1', {
      status: 'open',
      email: 'shopper@example.com',
      resumeUrl: 'https://acme.example.com/cart',
      createdAtMs: Date.now() - 2 * 60 * 60 * 1000,
    }),
  ]
}

/** A shopper waiting on a product that is back. */
const waitingShopper = () => {
  stored[`hosts/${SITE_A}/products/p1`] = {
    name: 'Mug',
    slug: 'mug',
    variants: [{ id: 'v1', inventory: 4 }],
  }
  rows['restockAlerts'] = [
    hostDoc('restockAlerts', 'a1', {
      email: 'shopper@example.com',
      productId: 'p1',
      notifiedAtMs: null,
    }),
  ]
}

/** A paying member, and the publish request that mails them. */
const memberPost = async () => {
  stored[`hosts/${SITE_A}`] = { memberRoles: { 'admin-uid': 'admin' } }
  rows['subscriptions'] = [
    hostDoc('subscriptions', 's1', {
      status: 'active',
      customerEmail: 'member@example.com',
    }),
  ]
  const res: any = { status: () => res, json: () => res }
  await memberPostHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: SITE_A, title: 'News', body: 'Hello', emailSubscribers: true },
    } as any,
    res,
  )
}

beforeEach(() => {
  contexts = []
  rows = {}
  stored = {}
  mockOrg = { plan: 'pro' }
})

describe.each([
  ['a cart reminder', async () => {
    leftCart()
    await scanAbandonedCheckouts(gate)
  }],
  ['a restock alert', async () => {
    waitingShopper()
    await scanRestockAlerts(gate)
  }],
  ['a member post', memberPost],
])('%s', (_name, run) => {
  it('names every site of the declared consent group as its sender', async () => {
    mockOrg = { ...DECLARED }
    await run()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.['hostId']).toBe(SITE_A)
    expect(contexts[0]?.['consentHostIds']).toEqual([SITE_A, SITE_B].sort())
    // A declared group whose org never set the switch does not wait.
    expect(contexts[0]?.['consentAwaitsConfirmation']).toBe(false)
  })

  it('says the group waits for a confirmation click once the org turns it on (AGL-3316)', async () => {
    mockOrg = { ...DECLARED, consentGroupsAwaitConfirmation: true }
    await run()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.['consentAwaitsConfirmation']).toBe(true)
  })

  it('CONTROL: names the site alone for an org that declared no group', async () => {
    await run()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.['consentHostIds']).toEqual([SITE_A])
    expect(contexts[0]?.['consentAwaitsConfirmation']).toBe(false)
  })

  it('CONTROL: a site alone never waits on anybody, even with the switch on', async () => {
    mockOrg = { plan: 'pro', consentGroupsAwaitConfirmation: true }
    await run()
    expect(contexts[0]?.['consentHostIds']).toEqual([SITE_A])
    expect(contexts[0]?.['consentAwaitsConfirmation']).toBe(false)
  })
})
