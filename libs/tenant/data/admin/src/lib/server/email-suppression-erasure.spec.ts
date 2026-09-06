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

import {
  emailSuppressionKey,
  HOST_ERASURE_SUPPRESSION_REASON,
  hostRefusesCaptureForErasure,
  suppressEmailForHostErasure,
} from './email-suppression'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
  Timestamp: class {},
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
}))

/*
 * The per-site list, as a map of `hosts/{hostId}/suppressions/{key}` rows.
 * Reads can be made to throw, because failing open on a read is the
 * behavior under test and a store that never fails cannot prove it.
 */
const rows = new Map<string, Record<string, any>>()
let readThrows = false

function docRef(path: string) {
  return {
    get: async () => {
      if (readThrows) throw new Error('unavailable')
      const data = rows.get(path)
      return {
        exists: data !== undefined,
        get: (field: string) => data?.[field],
        data: () => data,
      }
    },
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      rows.set(path, options?.merge ? { ...(rows.get(path) ?? {}), ...value } : { ...value })
    },
  }
}

const store = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => ({
        doc: (key: string) => docRef(`${name}/${id}/${sub}/${key}`),
      }),
    }),
  }),
}

const EMAIL = 'jane@example.com'
const KEY = emailSuppressionKey(EMAIL) as string

beforeEach(() => {
  rows.clear()
  readThrows = false
})

describe('suppressEmailForHostErasure', () => {
  it('writes a row keyed by the hash that carries no address', async () => {
    const result = await suppressEmailForHostErasure({ hostId: 'h1', email: EMAIL, firestore: store })
    expect(result).toEqual({ key: KEY, created: true })
    const row = rows.get(`hosts/h1/suppressions/${KEY}`)
    expect(row?.reason).toBe(HOST_ERASURE_SUPPRESSION_REASON)
    // The whole point of the row: the address is not on it.
    expect(row?.email).toBeNull()
    expect(JSON.stringify(row)).not.toContain(EMAIL)
  })

  it('removes the address an earlier unsubscribe row kept in the clear', async () => {
    // An unsubscribe stores the email beside the hash so a hub admin can
    // release it. Once the person is erased, that copy goes too.
    rows.set(`hosts/h1/suppressions/${KEY}`, { email: EMAIL, reason: 'unsubscribe' })
    const result = await suppressEmailForHostErasure({ hostId: 'h1', email: EMAIL, firestore: store })
    expect(result).toEqual({ key: KEY, created: false })
    const row = rows.get(`hosts/h1/suppressions/${KEY}`)
    expect(row?.email).toBeNull()
    expect(row?.reason).toBe(HOST_ERASURE_SUPPRESSION_REASON)
  })

  it('answers null for a value that cannot be keyed, and writes nothing', async () => {
    expect(await suppressEmailForHostErasure({ hostId: 'h1', email: 'nope', firestore: store })).toBeNull()
    expect(rows.size).toBe(0)
  })
})

describe('hostRefusesCaptureForErasure', () => {
  it('refuses an address whose row was written by an erasure', async () => {
    rows.set(`hosts/h1/suppressions/${KEY}`, { email: null, reason: HOST_ERASURE_SUPPRESSION_REASON })
    expect(await hostRefusesCaptureForErasure('h1', EMAIL, store)).toBe(true)
  })

  it('does not refuse an ordinary unsubscribe — a mailing preference is not an erasure', async () => {
    rows.set(`hosts/h1/suppressions/${KEY}`, { email: EMAIL, reason: 'unsubscribe' })
    expect(await hostRefusesCaptureForErasure('h1', EMAIL, store)).toBe(false)
  })

  it('does not refuse on another site — the erasure was one workspace\'s decision', async () => {
    rows.set(`hosts/h1/suppressions/${KEY}`, { email: null, reason: HOST_ERASURE_SUPPRESSION_REASON })
    expect(await hostRefusesCaptureForErasure('h2', EMAIL, store)).toBe(false)
  })

  it('does not refuse an address with no row, or one that cannot be keyed', async () => {
    expect(await hostRefusesCaptureForErasure('h1', EMAIL, store)).toBe(false)
    expect(await hostRefusesCaptureForErasure('h1', 'nope', store)).toBe(false)
    expect(await hostRefusesCaptureForErasure('h1', null, store)).toBe(false)
  })

  it('fails OPEN when the list cannot be read, and says so', async () => {
    // Refusing every capture on the site for as long as one read fails
    // would turn an outage into a silent drop of its leads and orders.
    rows.set(`hosts/h1/suppressions/${KEY}`, { email: null, reason: HOST_ERASURE_SUPPRESSION_REASON })
    readThrows = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await hostRefusesCaptureForErasure('h1', EMAIL, store)).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
