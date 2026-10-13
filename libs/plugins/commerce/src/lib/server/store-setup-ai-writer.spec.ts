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
 * The `store-settings` writer (AGL-3749) against an in-memory Firestore: who
 * may change the store's setup, the one map or location it writes and nothing
 * else on the document, a change asked again writing nothing, and the
 * refusals a person reads.
 */

import type { PluginDraftRequest } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  STORE_SETUP_LOCKED_REFUSAL,
  STORE_SETUP_PLAN_REFUSAL,
  STORE_SETUP_ROLE_REFUSAL,
  createStoreSetupAiWriter,
} from './store-setup-ai-writer'

type Data = Record<string, unknown>

const docs = new Map<string, Data>()
let writes = 0

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

class Snapshot {
  constructor(readonly ref: DocRef) {}
  get id() {
    return this.ref.id
  }
  get exists() {
    return docs.has(this.ref.path)
  }
  data() {
    const data = docs.get(this.ref.path)
    return data ? clone(data) : undefined
  }
}

class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  collection(name: string) {
    return new CollectionRef(`${this.path}/${name}`)
  }
  async get() {
    return new Snapshot(this)
  }
}

class CollectionRef {
  constructor(readonly path: string) {}
  doc(id: string) {
    return new DocRef(`${this.path}/${id}`)
  }
  async get() {
    const children = [...docs.keys()].filter(
      (path) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'),
    )
    return { docs: children.map((path) => new Snapshot(new DocRef(path))) }
  }
}

const firestore = {
  collection: (name: string) => new CollectionRef(name),
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (target: { get(): Promise<unknown> }) => target.get(),
      set: (ref: DocRef, data: Data, options: { mergeFields: string[] }) => {
        writes++
        const next = { ...(docs.get(ref.path) ?? {}) }
        for (const field of options.mergeFields) next[field] = data[field]
        docs.set(ref.path, next)
      },
      update: (ref: DocRef, data: Data) => {
        writes++
        if (!docs.has(ref.path)) throw new Error('5 NOT_FOUND')
        docs.set(ref.path, { ...(docs.get(ref.path) as Data), ...data })
      },
    })
  },
}

const HOST = 'host-1'
const EDITOR = 'uid-editor'
const VIEWER = 'uid-viewer'
const SETTINGS = `hosts/${HOST}/settings/store`
const BUSINESS = { plan: 'business' }
const FREE = { plan: 'free' }

let locked = false
const writer = createStoreSetupAiWriter({
  firestore: () => firestore as unknown as FirebaseFirestore.Firestore,
  lockdown: async () => locked,
})

function request(content: Data, overrides: Partial<PluginDraftRequest> = {}): PluginDraftRequest {
  return {
    orgId: 'org-1',
    hostId: HOST,
    uid: EDITOR,
    org: BUSINESS,
    now: new Date('2026-10-12T12:00:00Z'),
    id: 'build-1-i0',
    name: 'US shipping',
    content,
    ...overrides,
  }
}

const FREE_OVER_FIFTY = {
  section: 'shipping',
  zoneName: 'United States',
  countries: ['US'],
  rateName: 'Standard',
  kind: 'free_over',
  amountUsd: 5,
  freeOverUsd: 50,
}

beforeEach(() => {
  docs.clear()
  writes = 0
  locked = false
  docs.set(`hosts/${HOST}`, { memberRoles: { [EDITOR]: 'editor', [VIEWER]: 'viewer' } })
  docs.set(SETTINGS, {
    currency: 'USD',
    tax: { mode: 'none' },
    localDelivery: { enabled: false },
  })
})

describe('who may change the store setup', () => {
  it('refuses a viewer, a plan without commerce, a locked site and an unknown site', async () => {
    expect(await writer.refusal(request({}, { uid: VIEWER }))).toEqual({ status: 403, error: STORE_SETUP_ROLE_REFUSAL })
    expect(await writer.refusal(request({}, { org: FREE }))).toEqual({ status: 403, error: STORE_SETUP_PLAN_REFUSAL })
    locked = true
    expect(await writer.write(request(FREE_OVER_FIFTY))).toEqual({ ok: false, status: 403, error: STORE_SETUP_LOCKED_REFUSAL })
    locked = false
    expect(await writer.refusal(request({}, { hostId: 'nope' }))).toEqual({ status: 404, error: 'Unknown site' })
    expect(await writer.refusal(request({}))).toBeNull()
    expect(writes).toBe(0)
  })
})

describe('writing', () => {
  it('writes the shipping map alone, live, and leaves the rest of the document', async () => {
    const result = await writer.write(request(FREE_OVER_FIFTY))
    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      id: 'build-1-i0',
      name: 'US shipping',
      facts: { section: 'shipping', live: true, summary: 'United States: "Standard" is free over $50, otherwise $5.' },
    })
    expect(docs.get(SETTINGS)).toEqual({
      currency: 'USD',
      tax: { mode: 'none' },
      localDelivery: { enabled: false },
      shipping: {
        zones: [{ id: 'build-1-i0-zone', name: 'United States', countries: ['US'] }],
        rates: [
          { id: 'build-1-i0-rate', zoneId: 'build-1-i0-zone', name: 'Standard', kind: 'free_over', amountCents: 500, freeOverCents: 5000 },
        ],
      },
    })
  })

  it('writes nothing the second time it is asked', async () => {
    await writer.write(request(FREE_OVER_FIFTY))
    const before = clone(docs.get(SETTINGS))
    writes = 0
    expect(await writer.write(request(FREE_OVER_FIFTY))).toMatchObject({ ok: true, replayed: true })
    expect(await writer.write(request(FREE_OVER_FIFTY, { id: 'build-2-i0' }))).toMatchObject({ ok: true, replayed: true })
    expect(writes).toBe(0)
    expect(docs.get(SETTINGS)).toEqual(before)
  })

  it('creates the settings document on a store that never saved one', async () => {
    docs.delete(SETTINGS)
    expect(await writer.write(request({ section: 'tax', mode: 'stripe' }))).toMatchObject({ ok: true, replayed: false })
    expect(docs.get(SETTINGS)).toEqual({ tax: { mode: 'stripe' } })
  })

  it('turns pickup on at a location by its city, writing only its pickup map', async () => {
    docs.set(`hosts/${HOST}/locations/loc-a`, { name: 'Shop', postalAddress: { city: 'Austin' }, isDefault: true })
    const result = await writer.write(request({ section: 'pickup', location: 'Austin', instructions: 'Ring the side bell' }))
    expect(result).toMatchObject({ ok: true, replayed: false, facts: { summary: 'Buyers can pick up orders at Shop.' } })
    expect(docs.get(`hosts/${HOST}/locations/loc-a`)).toEqual({
      name: 'Shop',
      postalAddress: { city: 'Austin' },
      isDefault: true,
      pickup: { enabled: true, instructions: 'Ring the side bell' },
    })
    expect(docs.get(SETTINGS)?.['shipping']).toBeUndefined()
  })

  it('refuses what the content or the settings cannot hold, in words a person reads', async () => {
    expect(await writer.write(request({ section: 'tax' }))).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringMatching(/Say how the store handles sales tax/),
    })
    expect(await writer.write(request({ section: 'pickup', location: 'Houston' }))).toMatchObject({ ok: false, status: 404 })
    expect(await writer.write(request({ section: 'tax', mode: 'manual' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/need the store’s address/),
    })
    expect(writes).toBe(0)
  })
})

describe('check and read', () => {
  it('checks content without I/O', () => {
    expect(writer.check({ section: 'tax', mode: 'none' }, { hostId: HOST })).toEqual({ ok: true, facts: { section: 'tax', live: true } })
    expect(writer.check({ section: 'tax', rateCountry: 'US' }, { hostId: HOST })).toMatchObject({ ok: false })
  })

  it('reads the store setup as it stands', async () => {
    await writer.write(request(FREE_OVER_FIFTY))
    expect(await writer.read({ hostId: HOST, id: 'build-1-i0' })).toEqual({
      id: 'build-1-i0',
      name: 'Store settings',
      versionId: null,
      facts: { shippingZones: 1, shippingRates: 1, localPickup: false, localDelivery: false, taxMode: 'none', taxRates: 0, live: true },
    })
    expect(await writer.read({ hostId: 'nope', id: 'x' })).toBeNull()
  })
})
