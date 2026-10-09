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

import { memoryFirestore, memoryFirestoreModule } from '../testing/pos-ops-memory-firestore'

jest.mock('firebase-admin/firestore', () => memoryFirestoreModule)
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  getLockdownVerdict: jest.fn(),
  getOrgForHost: jest.fn(),
  isImpersonationSession: (decoded: { impersonatedBy?: string }) => Boolean(decoded.impersonatedBy),
}))

import { createOrderNoteHandler, createOrderRestockAnswerHandler } from './order-annotations'

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  editor: { uid: 'u-editor', email_verified: true },
  viewer: { uid: 'u-viewer', email_verified: true },
  unverified: { uid: 'u-editor', email_verified: false },
  staff: { uid: 'u-staff', staff: true },
}

const flagged = {
  kind: 'refund',
  lines: [{ productId: 'p1', variantId: 'small', quantity: 2, name: 'Latte' }],
  units: 2,
  fullyReversed: true,
  flaggedAtMs: 1_000,
}

function setup(options: { locked?: boolean } = {}) {
  const memory = memoryFirestore(() => 5_000)
  memory.seed('hosts/h1', { memberRoles: { 'u-editor': 'editor', 'u-viewer': 'viewer' } })
  memory.seed('hosts/h1/orders/o1', {
    status: 'paid',
    timeline: [{ atMs: 100, event: 'paid' }],
    restockCheck: flagged,
  })
  const deps = {
    firestore: () => memory.firestore,
    verifyIdToken: async (token: string) => {
      const decoded = TOKENS[token]
      if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
      return decoded
    },
    orgForHost: async () => ({ org: { plan: 'business' } }),
    lockdown: async () => (options.locked ? { scope: 'platform' } : null),
    dropCache: jest.fn(),
    now: () => 9_000,
  }
  return { memory, note: createOrderNoteHandler(deps), answer: createOrderRestockAnswerHandler(deps) }
}

function call(handler: any, token: string | null, body: Record<string, unknown>, method = 'POST') {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => ((res.statusCode = code), res)
  res.json = (value: unknown) => ((res.body = value), res)
  return Promise.resolve(
    handler({ method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) }, body }, res),
  ).then(() => res)
}

describe('commerce/order-note', () => {
  it('appends the note to the stored timeline', async () => {
    const { memory, note } = setup()
    const res = await call(note, 'editor', { hostId: 'h1', orderId: 'o1', note: '  Customer called  ' })
    expect(res.statusCode).toBe(200)
    expect(memory.read('hosts/h1/orders/o1')!['timeline']).toEqual([
      { atMs: 100, event: 'paid' },
      { atMs: 9_000, event: 'note', detail: 'Customer called' },
    ])
  })

  it('keeps an event another tab wrote, because it appends to the stored timeline', async () => {
    const { memory, note } = setup()
    memory.seed('hosts/h1/orders/o1', { status: 'paid', timeline: [{ atMs: 100, event: 'paid' }, { atMs: 200, event: 'note', detail: 'from the web' }] })
    await call(note, 'editor', { hostId: 'h1', orderId: 'o1', note: 'from the app' })
    expect((memory.read('hosts/h1/orders/o1')!['timeline'] as unknown[]).length).toBe(3)
  })

  it('cuts a note at 500 characters and refuses an empty one', async () => {
    const { memory, note } = setup()
    await call(note, 'editor', { hostId: 'h1', orderId: 'o1', note: 'x'.repeat(600) })
    const added = (memory.read('hosts/h1/orders/o1')!['timeline'] as Array<{ detail?: string }>)[1]
    expect(added.detail).toHaveLength(500)
    const empty = await call(note, 'editor', { hostId: 'h1', orderId: 'o1', note: '   ' })
    expect(empty.statusCode).toBe(400)
  })

  it.each([
    ['no token', null, 401],
    ['an unknown token', 'nobody', 401],
    ['an unverified email', 'unverified', 403],
    ['a role that cannot write', 'viewer', 403],
  ])('refuses %s', async (_case, token, status) => {
    const { memory, note } = setup()
    const res = await call(note, token, { hostId: 'h1', orderId: 'o1', note: 'hi' })
    expect(res.statusCode).toBe(status)
    expect((memory.read('hosts/h1/orders/o1')!['timeline'] as unknown[]).length).toBe(1)
  })

  it('refuses a frozen site, but staff write through, and a missing order is a 404', async () => {
    expect((await call(setup({ locked: true }).note, 'editor', { hostId: 'h1', orderId: 'o1', note: 'hi' })).statusCode).toBe(423)
    const open = setup()
    expect((await call(open.note, 'staff', { hostId: 'h1', orderId: 'o1', note: 'hi' })).statusCode).toBe(200)
    expect((await call(open.note, 'editor', { hostId: 'h1', orderId: 'gone', note: 'hi' })).statusCode).toBe(404)
    expect((await call(open.note, 'editor', { hostId: 'h1', orderId: 'o1', note: 'hi' }, 'GET')).statusCode).toBe(405)
  })
})

describe('commerce/order-restock-answer', () => {
  it('records the answer and the timeline line, and moves no stock', async () => {
    const { memory, answer } = setup()
    const res = await call(answer, 'editor', { hostId: 'h1', orderId: 'o1', resolution: 'restocked', flaggedAtMs: 1_000 })
    expect(res.body).toEqual({ ok: true, verdict: 'recorded' })
    const stored = memory.read('hosts/h1/orders/o1')!
    expect(stored['restockCheck']).toMatchObject({ resolution: 'restocked', resolvedAtMs: 9_000, resolvedBy: 'u-editor' })
    expect(stored['timeline']).toEqual([
      { atMs: 100, event: 'paid' },
      { atMs: 9_000, event: 'restock-check', detail: 'answered — restocked' },
    ])
  })

  it('answers "already answered" and "changed" without writing', async () => {
    const { memory, answer } = setup()
    const stale = await call(answer, 'editor', { hostId: 'h1', orderId: 'o1', resolution: 'dismissed', flaggedAtMs: 999 })
    expect(stale.body).toEqual({ ok: true, verdict: 'changed' })
    await call(answer, 'editor', { hostId: 'h1', orderId: 'o1', resolution: 'dismissed', flaggedAtMs: 1_000 })
    const again = await call(answer, 'editor', { hostId: 'h1', orderId: 'o1', resolution: 'restocked', flaggedAtMs: 1_000 })
    expect(again.body).toEqual({ ok: true, verdict: 'answered' })
    expect((memory.read('hosts/h1/orders/o1')!['restockCheck'] as { resolution: string }).resolution).toBe('dismissed')
  })

  it('refuses an unknown resolution and a role that cannot write', async () => {
    const { answer } = setup()
    expect((await call(answer, 'editor', { hostId: 'h1', orderId: 'o1', resolution: 'maybe', flaggedAtMs: 1_000 })).statusCode).toBe(400)
    expect((await call(answer, 'viewer', { hostId: 'h1', orderId: 'o1', resolution: 'restocked', flaggedAtMs: 1_000 })).statusCode).toBe(403)
  })
})
