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
 * The contact's own engagement stamp (AGL-2616): written by the delivery
 * webhook onto the sending site's facet, forward-only, first-of-type only,
 * and never onto a row the site may not see.
 */

import type { EmailDeliveryEventOutcome } from './email-delivery-log'

jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

let groupId = 'host-1'
let resolveFailure: Error | null = null
jest.mock('./organizations', () => ({
  orgDataCollectionForHost: async (hostId: string, name: string) => {
    if (resolveFailure) throw resolveFailure
    return fake.collection(`orgs/org-1/${name}`)
  },
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
}))

import { recordContactEmailEngagement } from './contact-email-engagement'

/*
 * A Firestore double that answers the one query the stamp makes — an
 * equality on `email` with a limit — inside a transaction, and applies a
 * DOTTED update path the way the Admin SDK does: `facets.g.f` lands nested,
 * beside whatever the map already held.
 */
const store = new Map<string, Record<string, any>>()

function setPath(target: Record<string, any>, path: string, value: unknown) {
  const keys = path.split('.')
  let cursor = target
  for (const key of keys.slice(0, -1)) {
    cursor[key] =
      cursor[key] && typeof cursor[key] === 'object' ? { ...cursor[key] } : {}
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
}

const docRef = (path: string) => ({
  path,
  id: path.split('/').pop() as string,
  update: async (data: Record<string, unknown>) => {
    if (!store.has(path)) throw new Error(`update of missing ${path}`)
    const next = { ...store.get(path) }
    for (const [key, value] of Object.entries(data)) setPath(next, key, value)
    store.set(path, next)
  },
})

const fake = {
  collection: (prefix: string) => ({
    where: (field: string, _op: string, value: unknown) => ({
      limit: (cap: number) => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${prefix}/`))
            .filter(([, data]) => data[field] === value)
            .slice(0, cap)
            .map(([path, data]) => ({
              id: path.split('/').pop(),
              ref: docRef(path),
              data: () => data,
            }))
          return { empty: docs.length === 0, docs }
        },
      }),
    }),
  }),
  runTransaction: async (body: (transaction: any) => Promise<void>) =>
    body({
      get: async (query: any) => query.get(),
      update: (ref: any, data: Record<string, unknown>) => {
        writes.push({ path: ref.path, data })
        void ref.update(data)
      },
    }),
}

const writes: Array<{ path: string; data: Record<string, unknown> }> = []

const HOST = 'host-1'
const CONTACT = 'orgs/org-1/contacts/c-1'
const EMAIL = 'dana@example.com'

const outcome = (
  over: Partial<EmailDeliveryEventOutcome> = {},
): EmailDeliveryEventOutcome => ({
  firstOfType: true,
  providerMessageId: 'msg-1',
  to: EMAIL,
  type: 'opened',
  at: 1_800_000_000_000,
  ...over,
})

const stamp = (outcomes: EmailDeliveryEventOutcome[], hostId = HOST) =>
  recordContactEmailEngagement({ hostId, outcomes, firestore: fake })

const facet = () => store.get(CONTACT)?.facets?.[groupId]

let errors: unknown[][] = []

beforeEach(() => {
  store.clear()
  writes.length = 0
  groupId = HOST
  resolveFailure = null
  errors = []
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args)
  })
  store.set(CONTACT, {
    email: EMAIL,
    name: 'Dana',
    visibleTo: [`host:${HOST}`],
    facets: { [HOST]: { sources: { form: true }, tags: ['vip'] } },
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a first open or click stamps the sending site’s facet', () => {
  it('writes the event’s instant under this holder’s facet and touches nothing else', async () => {
    expect(await stamp([outcome()])).toBe(1)

    expect(facet()).toEqual({
      sources: { form: true },
      tags: ['vip'],
      lastEmailEngagementAtMs: 1_800_000_000_000,
    })
    const doc = store.get(CONTACT)
    expect(doc.lastEmailEngagementAtMs).toBeUndefined()
    expect(doc.updatedAt).toBeUndefined()
    expect(writes).toEqual([
      {
        path: CONTACT,
        data: { [`facets.${HOST}.lastEmailEngagementAtMs`]: 1_800_000_000_000 },
      },
    ])
  })

  it('takes a click as engagement too, and keeps the newest instant of a batch', async () => {
    await stamp([
      outcome({ type: 'clicked', at: 1_800_000_000_500 }),
      outcome({ type: 'opened', at: 1_800_000_000_100, providerMessageId: 'msg-2' }),
    ])
    expect(facet().lastEmailEngagementAtMs).toBe(1_800_000_000_500)
    expect(writes).toHaveLength(1)
  })

  /*
   * The group, not the host: a site declared to be one sender with its
   * siblings keeps one facet under the group's id, and a stamp under the
   * host's id would be a facet nobody reads.
   */
  it('writes under the consent group’s id when the site belongs to one', async () => {
    groupId = 'group-9'
    store.set(CONTACT, {
      email: EMAIL,
      visibleTo: [`host:${HOST}`, 'host:host-2'],
      facets: { 'group-9': { sources: { order: true } } },
    })
    await stamp([outcome()])
    expect(store.get(CONTACT).facets['group-9'].lastEmailEngagementAtMs).toBe(
      1_800_000_000_000,
    )
    expect(store.get(CONTACT).facets[HOST]).toBeUndefined()
  })
})

describe('the stamp only ever moves forward', () => {
  it('advances on a newer instant and ignores an older one arriving late', async () => {
    await stamp([outcome({ at: 1_800_000_000_000 })])
    expect(await stamp([outcome({ at: 1_800_000_900_000, providerMessageId: 'm2' })])).toBe(1)
    expect(facet().lastEmailEngagementAtMs).toBe(1_800_000_900_000)

    expect(await stamp([outcome({ at: 1_700_000_000_000, providerMessageId: 'm3' })])).toBe(0)
    expect(facet().lastEmailEngagementAtMs).toBe(1_800_000_900_000)
    expect(writes).toHaveLength(2)
  })
})

describe('what does not stamp', () => {
  it('a repeat event for a message, or an event that is not an open or a click', async () => {
    expect(await stamp([outcome({ firstOfType: false })])).toBe(0)
    expect(await stamp([outcome({ type: 'delivered' })])).toBe(0)
    expect(await stamp([outcome({ type: 'bounced' })])).toBe(0)
    expect(facet().lastEmailEngagementAtMs).toBeUndefined()
    expect(writes).toEqual([])
  })

  it('an address that is no contact of this org', async () => {
    expect(await stamp([outcome({ to: 'stranger@example.com' })])).toBe(0)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })

  /*
   * ⛔ THE ROW IS SHARED, THE FACET IS NOT. A person another holder captured
   * and this site never met is not this site's contact, and a stamp would
   * mint a facet for a holder that does not hold them.
   */
  it('a contact this site may not see', async () => {
    store.set(CONTACT, {
      email: EMAIL,
      visibleTo: ['host:host-2'],
      facets: { 'host-2': { sources: { form: true } } },
    })
    expect(await stamp([outcome()])).toBe(0)
    expect(store.get(CONTACT).facets[HOST]).toBeUndefined()
    expect(writes).toEqual([])
  })

  it('an event with no site, or an unusable address or instant', async () => {
    expect(await stamp([outcome()], '')).toBe(0)
    expect(await stamp([outcome({ to: 'not an address' })])).toBe(0)
    expect(await stamp([outcome({ at: Number.NaN })])).toBe(0)
    expect(writes).toEqual([])
  })
})

describe('never throws', () => {
  it('answers zero and logs when the site resolves to no org', async () => {
    resolveFailure = new Error('Host host-1 has no org')
    await expect(stamp([outcome()])).resolves.toBe(0)
    expect(errors).toHaveLength(1)
    expect(writes).toEqual([])
  })

  it('answers what it wrote when one person’s transaction fails', async () => {
    const failing = {
      ...fake,
      runTransaction: async (body: (transaction: any) => Promise<void>) => {
        if (calls++ === 0) throw new Error('contention')
        return fake.runTransaction(body)
      },
    }
    let calls = 0
    store.set('orgs/org-1/contacts/c-2', {
      email: 'second@example.com',
      visibleTo: [`host:${HOST}`],
      facets: { [HOST]: {} },
    })
    const written = await recordContactEmailEngagement({
      hostId: HOST,
      outcomes: [outcome(), outcome({ to: 'second@example.com', providerMessageId: 'm2' })],
      firestore: failing,
    })
    expect(written).toBe(1)
    expect(errors).toHaveLength(1)
  })
})
