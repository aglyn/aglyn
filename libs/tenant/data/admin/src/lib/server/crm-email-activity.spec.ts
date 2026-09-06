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
 * The delivery webhook's write onto an email activity (AGL-2615).
 *
 * The claims a Firestore double can hold it to: the state only ever moves
 * forward, a failure outranks a success, two events for one message inside
 * one transaction cannot leave the earlier one on top, a row that is not an
 * email is left alone, and nothing here ever throws into the webhook.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
  },
}))

import {
  crmEmailDeliveryStateForEvent,
  newCrmActivityRef,
  recordCrmEmailDelivery,
  writeCrmEmailActivity,
} from './crm-email-activity'

/** Documents by path. */
const docs = new Map<string, Record<string, unknown>>()
/** Every write, in order, so a "nothing written" claim is checkable. */
const writes: Array<{ path: string; data: Record<string, unknown> }> = []
let minted = 0
let failTransactions = false

function docHandle(path: string): any {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => snapshotFor(path),
    set: async (data: Record<string, unknown>) => {
      docs.set(path, { ...data })
      writes.push({ path, data })
    },
    update: async (data: Record<string, unknown>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...data })
      writes.push({ path, data })
    },
  }
}

const snapshotFor = (path: string) => ({
  exists: docs.has(path),
  get: (field: string) => docs.get(path)?.[field],
  data: () => docs.get(path),
})

function collectionHandle(path: string): any {
  return {
    doc: (id?: string) => docHandle(`${path}/${id ?? `minted-${(minted += 1)}`}`),
  }
}

const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => collectionHandle(`${name}/${id}/${sub}`),
    }),
  }),
  runTransaction: async (
    work: (transaction: {
      get: (ref: any) => Promise<any>
      update: (ref: any, data: Record<string, unknown>) => void
    }) => Promise<unknown>,
  ) => {
    if (failTransactions) throw new Error('unavailable')
    return work({
      get: async (ref) => snapshotFor(ref.path),
      update: (ref, data) => {
        docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
        writes.push({ path: ref.path, data })
      },
    })
  },
}

const ORG = 'org-1'
const ROW = `orgs/${ORG}/crmActivities/act-1`

const seedEmail = (deliveryState: string, extra: Record<string, unknown> = {}) =>
  docs.set(ROW, { kind: 'email', deliveryState, deliveryAtMs: 1_000, ...extra })

const deliver = (state: any, atMs = 5_000) =>
  recordCrmEmailDelivery(firestore, { orgId: ORG, activityId: 'act-1', state, atMs })

beforeEach(() => {
  docs.clear()
  writes.length = 0
  minted = 0
  failTransactions = false
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('recordCrmEmailDelivery', () => {
  it('advances the row and stamps when it happened', async () => {
    seedEmail('sent')
    await expect(deliver('delivered')).resolves.toBe('advanced')
    expect(docs.get(ROW)).toMatchObject({
      deliveryState: 'delivered',
      deliveryAtMs: 5_000,
      updatedAt: 'server-timestamp',
    })
  })

  it('writes nothing for an event the row is already past', async () => {
    seedEmail('opened')
    await expect(deliver('delivered')).resolves.toBe('unchanged')
    await expect(deliver('opened')).resolves.toBe('unchanged')
    expect(writes).toEqual([])
    expect(docs.get(ROW)?.['deliveryAtMs']).toBe(1_000)
  })

  it('lets a bounce override an open', async () => {
    seedEmail('opened')
    await expect(deliver('bounced')).resolves.toBe('advanced')
    expect(docs.get(ROW)?.['deliveryState']).toBe('bounced')
    // And nothing after a failure moves it back.
    await expect(deliver('clicked')).resolves.toBe('unchanged')
    expect(docs.get(ROW)?.['deliveryState']).toBe('bounced')
  })

  it('keeps the later event on top whichever order two arrive in', async () => {
    seedEmail('sent')
    await deliver('opened', 2_000)
    await deliver('delivered', 1_500)
    expect(docs.get(ROW)).toMatchObject({ deliveryState: 'opened', deliveryAtMs: 2_000 })
  })

  it('answers missing, and writes nothing, for a row that does not exist', async () => {
    await expect(deliver('delivered')).resolves.toBe('missing')
    expect(writes).toEqual([])
    await expect(
      recordCrmEmailDelivery(firestore, { orgId: '', activityId: 'act-1', state: 'delivered', atMs: 1 }),
    ).resolves.toBe('missing')
  })

  it('leaves a row that is not an email alone', async () => {
    docs.set(ROW, { kind: 'call', body: 'Spoke to Ada' })
    await expect(deliver('delivered')).resolves.toBe('missing')
    expect(docs.get(ROW)).toEqual({ kind: 'call', body: 'Spoke to Ada' })
  })

  it('never throws — a failed transaction is logged and reported', async () => {
    seedEmail('sent')
    failTransactions = true
    await expect(deliver('delivered')).resolves.toBe('failed')
    expect(console.error).toHaveBeenCalled()
  })

  it('falls back to the clock for an event with no usable time', async () => {
    seedEmail('sent')
    await deliver('delivered', Number.NaN)
    expect(docs.get(ROW)?.['deliveryAtMs']).toEqual(expect.any(Number))
    expect(Number.isFinite(docs.get(ROW)?.['deliveryAtMs'])).toBe(true)
  })
})

describe('writeCrmEmailActivity', () => {
  it('sets the row under the minted id with the server clock on both stamps', async () => {
    const ref = newCrmActivityRef(firestore, ORG)
    expect(ref.path).toBe(`orgs/${ORG}/crmActivities/minted-1`)
    await writeCrmEmailActivity(ref, {
      kind: 'email',
      body: 'Hello',
      atMs: 10,
      byUid: 'u-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
    })
    expect(docs.get(ref.path)).toEqual({
      kind: 'email',
      body: 'Hello',
      atMs: 10,
      byUid: 'u-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    })
  })
})

describe('crmEmailDeliveryStateForEvent', () => {
  it('maps the five states the timeline shows, and nothing else', () => {
    expect(crmEmailDeliveryStateForEvent('delivered')).toBe('delivered')
    expect(crmEmailDeliveryStateForEvent('opened')).toBe('opened')
    expect(crmEmailDeliveryStateForEvent('clicked')).toBe('clicked')
    expect(crmEmailDeliveryStateForEvent('bounced')).toBe('bounced')
    expect(crmEmailDeliveryStateForEvent('complained')).toBe('complained')
    expect(crmEmailDeliveryStateForEvent('delayed')).toBeNull()
    expect(crmEmailDeliveryStateForEvent('failed')).toBeNull()
    expect(crmEmailDeliveryStateForEvent(undefined)).toBeNull()
  })
})
